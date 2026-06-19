/**
 * Supabase Storage upload helper (S3-compatible) + shared env/tippecanoe utilities
 * for the tile build. Used by build.ts and geoBoundaries.ts.
 *
 * Supabase Storage speaks the S3 protocol, so we talk to it with @aws-sdk/client-s3
 * pointed at the project's Storage S3 endpoint
 * `https://<project-ref>.storage.supabase.co/storage/v1/s3` with the project region
 * and forcePathStyle: true (REQUIRED for Supabase Storage S3). Credentials are the
 * S3 access keys minted in the Supabase dashboard (Project Settings → Storage → S3
 * Access Keys) — distinct from the anon/service_role keys — and the bucket come from
 * SUPABASE_S3_* / SUPABASE_STORAGE_BUCKET env vars (PRD §8) — never from source. The
 * tiles ride on the existing Supabase Pro plan; one object per source per night is
 * negligible against the included storage/egress.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/** Resolved Supabase Storage connection config, read from process.env. */
export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface TileUploadResult {
  bucket: string;
  key: string;
  /** Bytes of the object PUT to Supabase Storage. */
  bytes: number;
  contentType: string;
}

/** PMTiles archives are served as this content type so the CDN sets it correctly. */
export const PMTILES_CONTENT_TYPE = 'application/vnd.pmtiles';

/**
 * Read the SUPABASE_S3_* / SUPABASE_STORAGE_BUCKET vars from the environment or
 * throw with an actionable list of what's missing. No connection detail is ever
 * hardcoded (PRD §0.3, §8).
 */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const endpoint = env['SUPABASE_S3_ENDPOINT'];
  const region = env['SUPABASE_S3_REGION'];
  const accessKeyId = env['SUPABASE_S3_ACCESS_KEY_ID'];
  const secretAccessKey = env['SUPABASE_S3_SECRET_ACCESS_KEY'];
  const bucket = env['SUPABASE_STORAGE_BUCKET'];

  const missing = [
    ['SUPABASE_S3_ENDPOINT', endpoint],
    ['SUPABASE_S3_REGION', region],
    ['SUPABASE_S3_ACCESS_KEY_ID', accessKeyId],
    ['SUPABASE_S3_SECRET_ACCESS_KEY', secretAccessKey],
    ['SUPABASE_STORAGE_BUCKET', bucket],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase Storage env var(s): ${missing.join(', ')}. ` +
        'The tile build reads Supabase Storage credentials from the environment (no secrets in source). ' +
        'See .env.example for the SUPABASE_S3_ENDPOINT/SUPABASE_S3_REGION/SUPABASE_S3_ACCESS_KEY_ID/SUPABASE_S3_SECRET_ACCESS_KEY/SUPABASE_STORAGE_BUCKET inventory.',
    );
  }

  // Non-null asserted: the `missing` check above guarantees all five are set.
  return {
    endpoint: endpoint!,
    region: region!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
  };
}

/** Build an S3Client configured for Supabase Storage (forcePathStyle REQUIRED). */
export function makeStorageClient(cfg: StorageConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

/**
 * Upload one local file to Supabase Storage as `key`. Reads the whole file into a
 * Buffer (our tile objects are tens of MB at most). Returns the bucket/key/size
 * for logging.
 */
export async function uploadFileToStorage(
  client: S3Client,
  cfg: StorageConfig,
  localPath: string,
  key: string,
  contentType: string = PMTILES_CONTENT_TYPE,
): Promise<TileUploadResult> {
  const body = await readFile(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { bucket: cfg.bucket, key, bytes: body.byteLength, contentType };
}

/**
 * Verify tippecanoe is installed and on PATH, failing LOUDLY with an actionable
 * message if not (PRD: "Guard the shell-out so a missing tippecanoe fails loudly").
 * Returns the version string on success.
 */
export function assertTippecanoeInstalled(binary = 'tippecanoe'): string {
  let res: SpawnSyncReturns<string>;
  try {
    res = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(tippecanoeMissingMessage(binary, err));
  }
  // ENOENT surfaces as res.error rather than a throw on most platforms.
  if (res.error || res.status === null) {
    throw new Error(tippecanoeMissingMessage(binary, res.error));
  }
  // tippecanoe prints its version to stderr.
  return (res.stderr || res.stdout || '').trim();
}

function tippecanoeMissingMessage(binary: string, cause: unknown): string {
  const detail = cause instanceof Error ? ` (${cause.message})` : '';
  return (
    `'${binary}' was not found on PATH${detail}. ` +
    'tippecanoe MUST be installed in the CI/runner image that runs the nightly tile build. ' +
    'Install it from https://github.com/felt/tippecanoe (or `brew install tippecanoe` locally).'
  );
}
