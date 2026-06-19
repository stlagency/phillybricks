/**
 * Pure unit tests for @bandbox/tiles — NO DB, NO network, NO tippecanoe.
 * Covers env parsing, object-key derivation, and the loud-failure guards.
 *
 * Lives under src/ (not test/) to stay within the package's tsconfig rootDir;
 * vitest still discovers *.test.ts here.
 */
import { describe, it, expect } from 'vitest';
import {
  storageConfigFromEnv,
  assertTippecanoeInstalled,
  PMTILES_CONTENT_TYPE,
} from './storage.js';
import { PARCEL_TILES_KEY, PARCEL_LAYER, requireDatabaseUrl } from './build.js';
import { boundaryTilesKey, BOUNDARY_GEO_TYPES } from './geoBoundaries.js';

const FULL_STORAGE_ENV: NodeJS.ProcessEnv = {
  SUPABASE_S3_ENDPOINT: 'https://ctcvrdsrylauqpuxbauz.storage.supabase.co/storage/v1/s3',
  SUPABASE_S3_REGION: 'us-east-1',
  SUPABASE_S3_ACCESS_KEY_ID: 'ak',
  SUPABASE_S3_SECRET_ACCESS_KEY: 'sk',
  SUPABASE_STORAGE_BUCKET: 'phillybricks-tiles',
};

describe('storageConfigFromEnv', () => {
  it('reads all five SUPABASE_S3_* / SUPABASE_STORAGE_BUCKET vars from the provided env', () => {
    const cfg = storageConfigFromEnv(FULL_STORAGE_ENV);
    expect(cfg).toEqual({
      endpoint: 'https://ctcvrdsrylauqpuxbauz.storage.supabase.co/storage/v1/s3',
      region: 'us-east-1',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      bucket: 'phillybricks-tiles',
    });
  });

  it('throws an actionable error listing every missing var', () => {
    expect(() => storageConfigFromEnv({})).toThrow(/SUPABASE_S3_ENDPOINT/);
    expect(() => storageConfigFromEnv({})).toThrow(/SUPABASE_STORAGE_BUCKET/);
  });

  it('names only the actually-missing var in the missing-list', () => {
    const partial: NodeJS.ProcessEnv = { ...FULL_STORAGE_ENV };
    delete partial.SUPABASE_S3_SECRET_ACCESS_KEY;
    // Pull the "Missing Supabase Storage env var(s): …" list (before the period) and
    // assert on it, not on the trailing .env.example inventory which mentions every var.
    let message = '';
    try {
      storageConfigFromEnv(partial);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    const missingList = message.split('.')[0] ?? '';
    expect(missingList).toMatch(/SUPABASE_S3_SECRET_ACCESS_KEY/);
    expect(missingList).not.toMatch(/SUPABASE_STORAGE_BUCKET/);
    expect(missingList).not.toMatch(/SUPABASE_S3_ENDPOINT/);
  });
});

describe('object keys + constants', () => {
  it('uses a single stable parcel object key', () => {
    expect(PARCEL_TILES_KEY).toBe('parcels.pmtiles');
    expect(PARCEL_LAYER).toBe('parcels');
  });

  it('namespaces boundary keys per geo type', () => {
    expect(boundaryTilesKey('zip')).toBe('boundaries/zip.pmtiles');
    expect(boundaryTilesKey('neighborhood')).toBe('boundaries/neighborhood.pmtiles');
    expect(boundaryTilesKey('tract')).toBe('boundaries/tract.pmtiles');
  });

  it('covers exactly the three contract geo types', () => {
    expect([...BOUNDARY_GEO_TYPES]).toEqual(['zip', 'neighborhood', 'tract']);
  });

  it('serves PMTiles with the pmtiles content type', () => {
    expect(PMTILES_CONTENT_TYPE).toBe('application/vnd.pmtiles');
  });
});

describe('requireDatabaseUrl', () => {
  it('returns DATABASE_URL when present', () => {
    expect(requireDatabaseUrl({ DATABASE_URL: 'postgres://x' })).toBe('postgres://x');
  });
  it('throws (no secret hardcoding) when absent', () => {
    expect(() => requireDatabaseUrl({})).toThrow(/DATABASE_URL is not set/);
  });
});

describe('assertTippecanoeInstalled', () => {
  it('fails loudly with an install pointer when the binary is missing', () => {
    // A name that cannot exist on PATH → spawnSync returns ENOENT.
    expect(() => assertTippecanoeInstalled('tippecanoe-does-not-exist-xyz')).toThrow(
      /tippecanoe MUST be installed/,
    );
    expect(() => assertTippecanoeInstalled('tippecanoe-does-not-exist-xyz')).toThrow(
      /not found on PATH/,
    );
  });
});
