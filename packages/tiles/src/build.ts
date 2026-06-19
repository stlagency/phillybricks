/**
 * Nightly parcel tile build (PRD §4 worker step "build tiles", §6 "Tiles", M4).
 *
 * WHAT IT DOES (runs AFTER derived-refresh, as the last nightly worker step):
 *   1. Stream every active parcel from public.parcel as one GeoJSON Feature per
 *      line (newline-delimited GeoJSON / "GeoJSONSeq"), carrying the geometry
 *      (from `geom`, never lat/lng columns) plus the choropleth-relevant keys
 *      the client needs to color a parcel from public.geo_metric.
 *   2. Pipe that ndjson straight into tippecanoe's stdin, producing a SINGLE
 *      `parcels.pmtiles` archive.
 *   3. Upload that ONE object to Supabase Storage (S3-compatible).
 *
 * No dynamic ST_AsMVT base map — the whole base map is this static, CDN-served,
 * HTTP-range-read PMTiles object, rebuilt once per night. One PUT per source per
 * night is negligible against the existing Supabase Pro plan (PRD §6 "Tiles").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TIPPECANOE — REQUIRED IN THE CI/RUNNER IMAGE.
 * tippecanoe is a native binary; it is NOT an npm dependency and MUST be present
 * on PATH in the GitHub Actions runner / docker image that runs this build.
 * `assertTippecanoeInstalled()` guards the shell-out and fails loudly with an
 * install pointer if it is missing.
 *
 * Flags used (and why):
 *   --output=…  / -o            Write the PMTiles archive (extension .pmtiles → PMTiles).
 *   --force / -f                Overwrite the previous night's local artifact.
 *   --layer=parcels / -l        Single named vector layer the web client expects.
 *   --read-parallel / -P        Parse the ndjson input in parallel (faster build).
 *   --maximum-zoom=16 / -z16    Parcel detail resolves by z16; deeper wastes size.
 *   --minimum-zoom=10 / -Z10    Individual parcels are meaningless below ~z10
 *                               (the aggregate boundary tiles cover the low zooms).
 *   --coalesce-densest-as-needed  Drop/merge the densest features per tile to hold
 *                               the tile-size budget instead of failing the build.
 *   --extend-zooms-if-still-dropping  Add zoom levels if features are still being
 *                               dropped at max zoom, so dense blocks stay legible.
 *   --no-tile-size-limit        Parcels are tiny polygons-as-points; allow the few
 *                               dense downtown tiles to exceed the 500 KB soft cap
 *                               rather than silently dropping parcels from the map.
 *   --attribution=…             Philly open-data attribution baked into the archive
 *                               (license requires source disclaimers, PRD §1/§8).
 * The input is fed on stdin, so the trailing tippecanoe arg is `/dev/stdin`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import postgres, { type Sql } from 'postgres';
import {
  assertTippecanoeInstalled,
  makeStorageClient,
  storageConfigFromEnv,
  uploadFileToStorage,
  type StorageConfig,
  type TileUploadResult,
} from './storage.js';

/** The single object key written to Storage every night. Stable so the CDN URL is stable. */
export const PARCEL_TILES_KEY = 'parcels.pmtiles';
/** Vector layer name inside the archive; the web client (MapLibre) references this. */
export const PARCEL_LAYER = 'parcels';

export interface BuildParcelTilesOptions {
  /**
   * Connection string. Defaults to process.env.DATABASE_URL (PRD §8). Pass an
   * existing postgres `Sql` via `sql` instead when the worker already holds one.
   */
  databaseUrl?: string;
  /** Reuse an open postgres client (the nightly worker's). If given, it is NOT closed here. */
  sql?: Sql;
  /** Override Storage config (defaults to storageConfigFromEnv()). */
  storage?: StorageConfig;
  /** Override the tippecanoe binary name/path (default 'tippecanoe'). */
  tippecanoeBin?: string;
  /** Override the Storage object key (default PARCEL_TILES_KEY). */
  key?: string;
  /**
   * Skip the Storage upload (build the local .pmtiles only). For local/dry runs;
   * the nightly job leaves this false.
   */
  skipUpload?: boolean;
  /** Sink for progress logs. Defaults to console.log. */
  log?: (msg: string) => void;
}

export interface BuildParcelTilesResult {
  /** Parcel features streamed into tippecanoe. */
  featureCount: number;
  /** Local path of the produced archive (in a temp dir, removed after upload). */
  localPath: string;
  /** Storage upload result, or null when skipUpload. */
  upload: TileUploadResult | null;
  tippecanoeVersion: string;
}

/**
 * SQL that emits the choropleth-relevant parcel fields as GeoJSON Feature rows.
 * Geometry comes from `geom` only (no lat/lng). Properties are the minimum the
 * client needs to (a) identify the parcel for click→deep-dive and (b) join to
 * public.geo_metric for the active lens (the geo-unit ids + a couple of fields
 * the parcel-level filter panel uses). Only active parcels are tiled.
 *
 * ST_AsGeoJSON(row) builds a complete Feature (geometry + the selected non-geom
 * columns as properties), so each row is already a one-line GeoJSON Feature.
 */
function parcelFeatureQuery(sql: Sql): AsyncIterable<{ feature: string }[]> {
  // `.cursor(n)` streams in batches so we never buffer 584K rows in memory.
  return sql<{ feature: string }[]>`
    select ST_AsGeoJSON(t.*)::text as feature
    from (
      select
        geom,
        parcel_pk,
        zip,
        neighborhood_id,
        zip_id,
        tract_id,
        category_code,
        market_value,
        is_out_of_state_owner
      from public.parcel
      where is_active = true
        and geom is not null
    ) as t
  `.cursor(5000);
}

/**
 * Build parcels.pmtiles and (unless skipUpload) upload it to Supabase Storage as a single object.
 * Streams DB rows → tippecanoe stdin → PMTiles, so peak memory stays flat.
 */
export async function buildParcelTiles(
  opts: BuildParcelTilesOptions = {},
): Promise<BuildParcelTilesResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const tippecanoeBin = opts.tippecanoeBin ?? 'tippecanoe';
  const key = opts.key ?? PARCEL_TILES_KEY;

  // Fail loudly + early if the native binary is missing — before we open the DB.
  const tippecanoeVersion = assertTippecanoeInstalled(tippecanoeBin);
  log(`tippecanoe: ${tippecanoeVersion}`);

  const ownsSql = !opts.sql;
  const sql =
    opts.sql ?? postgres(opts.databaseUrl ?? requireDatabaseUrl(), { max: 1, onnotice: () => {} });

  const workDir = await mkdtemp(join(tmpdir(), 'phillybricks-tiles-'));
  const localPath = join(workDir, key);

  try {
    const tippecanoeArgs = [
      `--output=${localPath}`,
      '--force',
      `--layer=${PARCEL_LAYER}`,
      '--read-parallel',
      '--maximum-zoom=16',
      '--minimum-zoom=10',
      '--coalesce-densest-as-needed',
      '--extend-zooms-if-still-dropping',
      '--no-tile-size-limit',
      '--attribution=Source: City of Philadelphia open data (no City endorsement).',
      '/dev/stdin',
    ];

    const featureCount = await runTippecanoe(
      tippecanoeBin,
      tippecanoeArgs,
      () => parcelFeatureQuery(sql),
      log,
    );
    log(`parcel tiles: streamed ${featureCount.toLocaleString()} features → ${localPath}`);

    let upload: TileUploadResult | null = null;
    if (!opts.skipUpload) {
      const cfg = opts.storage ?? storageConfigFromEnv();
      const client = makeStorageClient(cfg);
      upload = await uploadFileToStorage(client, cfg, localPath, key);
      client.destroy();
      log(
        `uploaded ${upload.bytes.toLocaleString()} bytes → s3://${upload.bucket}/${upload.key}`,
      );
    }

    return { featureCount, localPath, upload, tippecanoeVersion };
  } finally {
    if (ownsSql) await sql.end({ timeout: 5 });
    // Best-effort temp cleanup; never mask a real error with a cleanup failure.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Read DATABASE_URL from env or throw — never hardcode a connection string (PRD §0.3). */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The tile build reads the connection string from the environment (no secrets in source).',
    );
  }
  return url;
}

/**
 * Spawn tippecanoe, stream newline-delimited GeoJSON features into its stdin from
 * the given async batch source, and resolve with the feature count once the
 * process exits 0. Rejects (loudly) on any non-zero exit, spawn error, or a write
 * error, so a failed tile build fails the nightly job rather than uploading junk.
 *
 * `source` is a thunk so the cursor query is created lazily once we're inside.
 */
function runTippecanoe(
  bin: string,
  args: string[],
  source: () => AsyncIterable<{ feature: string }[]>,
  log: (msg: string) => void,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'inherit', 'inherit'] });
    // stdio[0] is 'pipe', so stdin is a writable stream; narrow once for TS.
    const stdin = child.stdin;
    if (!stdin) {
      reject(new Error('tippecanoe child stdin pipe was not created.'));
      return;
    }

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      stdin.destroy();
      reject(err);
    };

    child.on('error', (err) =>
      fail(new Error(`Failed to spawn '${bin}': ${err.message}. Is tippecanoe installed on PATH?`)),
    );

    let count = 0;
    const pump = async () => {
      for await (const batch of source()) {
        let chunk = '';
        for (const row of batch) {
          chunk += row.feature;
          chunk += '\n';
          count += 1;
        }
        if (chunk.length > 0) {
          await new Promise<void>((res, rej) =>
            stdin.write(chunk, (err) => (err ? rej(err) : res())),
          );
        }
      }
      // Closing stdin tells tippecanoe the feature stream is complete.
      await new Promise<void>((res) => stdin.end(res));
    };

    child.on('close', (code) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        resolve(count);
      } else {
        fail(new Error(`tippecanoe exited with code ${code} after ${count} features.`));
      }
    });

    pump().catch((err) => {
      log(`tile build: error while streaming features — ${err instanceof Error ? err.message : err}`);
      fail(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

// CLI entrypoint: build + upload, report, exit non-zero on failure.
if (import.meta.url === `file://${process.argv[1]}`) {
  buildParcelTiles()
    .then((r) => {
      console.log(
        `✅ parcels.pmtiles built (${r.featureCount.toLocaleString()} features)` +
          (r.upload ? ` and uploaded to s3://${r.upload.bucket}/${r.upload.key}` : ' (upload skipped)'),
      );
    })
    .catch((err) => {
      console.error('❌ Parcel tile build failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
