/**
 * Aggregate-boundary tiles (PRD §6 "Tiles": "Aggregate boundaries as small static
 * GeoJSON/PMTiles"; §7.1 multi-resolution ZIP→neighborhood→tract→parcel).
 *
 * Builds one tiny PMTiles archive per geo type (zip, neighborhood, tract) from
 * public.geo_boundary and uploads each as a single static object to Supabase
 * Storage. These are
 * the low-zoom choropleth layers the client colors from public.geo_metric for the
 * active lens; the per-parcel layer (build.ts) covers the high zooms.
 *
 * There are only a few hundred polygons per type, so these archives are KB-sized
 * and rebuilt cheaply alongside the parcel tiles. tippecanoe is REQUIRED on PATH
 * in the CI/runner image (see build.ts header). We feed it newline-delimited
 * GeoJSON on stdin, same as the parcel build.
 *
 * tippecanoe flags here differ from the parcel build because polygons must stay
 * visible at low zoom and must NOT be simplified into uselessness:
 *   --output=… / --force / --layer=<geoType>   archive + named layer per type.
 *   --minimum-zoom=0 / -Z0                      boundaries visible from the city-wide view.
 *   --maximum-zoom=12 / -z12                    enough detail before parcels take over.
 *   --no-tile-size-limit                        a few hundred polygons never strain it,
 *                                               but never silently drop a boundary.
 *   --no-feature-limit                          keep every geo unit in every tile.
 *   --detect-shared-borders                     cleaner adjacent-polygon edges at low zoom.
 *   --attribution=…                             Philly open-data attribution (PRD §1/§8).
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
import { requireDatabaseUrl } from './build.js';

/** The geo aggregation units, matching GeoType in the frozen city-adapter contract. */
export const BOUNDARY_GEO_TYPES = ['zip', 'neighborhood', 'tract'] as const;
export type BoundaryGeoType = (typeof BOUNDARY_GEO_TYPES)[number];

/** Storage object key for a geo type's boundary archive, e.g. 'boundaries/zip.pmtiles'. */
export function boundaryTilesKey(geoType: BoundaryGeoType): string {
  return `boundaries/${geoType}.pmtiles`;
}

export interface BuildBoundaryTilesOptions {
  databaseUrl?: string;
  /** Reuse an open postgres client (the nightly worker's). If given, it is NOT closed here. */
  sql?: Sql;
  storage?: StorageConfig;
  tippecanoeBin?: string;
  /** Restrict to a subset of geo types (default: all three). */
  geoTypes?: readonly BoundaryGeoType[];
  /** Skip the Storage upload (build local .pmtiles only). */
  skipUpload?: boolean;
  log?: (msg: string) => void;
}

export interface BoundaryLayerResult {
  geoType: BoundaryGeoType;
  featureCount: number;
  localPath: string;
  upload: TileUploadResult | null;
}

export interface BuildBoundaryTilesResult {
  layers: BoundaryLayerResult[];
  tippecanoeVersion: string;
}

/** Fetch all boundary features for one geo type as one-line GeoJSON Features. */
function boundaryFeatureQuery(sql: Sql, geoType: BoundaryGeoType): AsyncIterable<{ feature: string }[]> {
  return sql<{ feature: string }[]>`
    select ST_AsGeoJSON(t.*)::text as feature
    from (
      select geom, geo_id, name
      from public.geo_boundary
      where geo_type = ${geoType}
        and geom is not null
    ) as t
  `.cursor(1000);
}

/**
 * Build + upload one tiny PMTiles archive per geo type. Each is a single static
 * Supabase Storage object. Returns per-layer counts/paths for the nightly run log.
 */
export async function buildBoundaryTiles(
  opts: BuildBoundaryTilesOptions = {},
): Promise<BuildBoundaryTilesResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const tippecanoeBin = opts.tippecanoeBin ?? 'tippecanoe';
  const geoTypes = opts.geoTypes ?? BOUNDARY_GEO_TYPES;

  const tippecanoeVersion = assertTippecanoeInstalled(tippecanoeBin);
  log(`tippecanoe: ${tippecanoeVersion}`);

  const ownsSql = !opts.sql;
  const sql =
    opts.sql ?? postgres(opts.databaseUrl ?? requireDatabaseUrl(), { max: 1, onnotice: () => {} });

  const workDir = await mkdtemp(join(tmpdir(), 'bandbox-boundaries-'));
  const layers: BoundaryLayerResult[] = [];

  let client: ReturnType<typeof makeStorageClient> | null = null;
  let cfg: StorageConfig | null = null;
  if (!opts.skipUpload) {
    cfg = opts.storage ?? storageConfigFromEnv();
    client = makeStorageClient(cfg);
  }

  try {
    for (const geoType of geoTypes) {
      const key = boundaryTilesKey(geoType);
      const localPath = join(workDir, `${geoType}.pmtiles`);
      const args = [
        `--output=${localPath}`,
        '--force',
        `--layer=${geoType}`,
        '--minimum-zoom=0',
        '--maximum-zoom=12',
        '--no-tile-size-limit',
        '--no-feature-limit',
        '--detect-shared-borders',
        '--attribution=Source: City of Philadelphia open data (no City endorsement).',
        '/dev/stdin',
      ];

      const featureCount = await runTippecanoe(
        tippecanoeBin,
        args,
        () => boundaryFeatureQuery(sql, geoType),
        log,
      );
      log(`boundary tiles[${geoType}]: ${featureCount.toLocaleString()} features → ${localPath}`);

      let upload: TileUploadResult | null = null;
      if (client && cfg) {
        upload = await uploadFileToStorage(client, cfg, localPath, key);
        log(`uploaded ${upload.bytes.toLocaleString()} bytes → s3://${upload.bucket}/${upload.key}`);
      }

      layers.push({ geoType, featureCount, localPath, upload });
    }

    return { layers, tippecanoeVersion };
  } finally {
    client?.destroy();
    if (ownsSql) await sql.end({ timeout: 5 });
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Spawn tippecanoe and stream newline-delimited GeoJSON features into its stdin
 * from the given async batch source. Resolves with the feature count on exit 0,
 * rejects loudly otherwise. (Local to this module to keep the two builds
 * independently importable; mirrors build.ts.)
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
      log(`boundary build: error while streaming features — ${err instanceof Error ? err.message : err}`);
      fail(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

// CLI entrypoint: build all three boundary layers + upload.
if (import.meta.url === `file://${process.argv[1]}`) {
  buildBoundaryTiles()
    .then((r) => {
      const summary = r.layers
        .map((l) => `${l.geoType}=${l.featureCount}${l.upload ? '↑' : ''}`)
        .join(', ');
      console.log(`✅ boundary tiles built: ${summary}`);
    })
    .catch((err) => {
      console.error('❌ Boundary tile build failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
