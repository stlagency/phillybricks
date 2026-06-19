/**
 * @bandbox/tiles — the nightly tile build (PRD §4, §6 "Tiles", M4).
 *
 * Pipeline role (PRD §2, ASCII flow): runs AFTER derived-refresh, as the LAST
 * step of the nightly worker. Produces a SINGLE `parcels.pmtiles` object plus
 * the tiny static aggregate-boundary tiles, and uploads them to Supabase Storage
 * (S3-compatible). MapLibre reads them from the CDN via HTTP range — there is NO
 * dynamic ST_AsMVT base map (egress discipline, PRD §6 "Tiles").
 *
 *   public.parcel (geom + choropleth keys) ─┐
 *                                            ├─► ndjson GeoJSON ─► tippecanoe ─► *.pmtiles ─► Storage
 *   public.geo_boundary (zip/nbhd/tract) ───┘
 *
 * tippecanoe MUST be installed in the CI/runner image (see build.ts header).
 * Reads DATABASE_URL + SUPABASE_S3_* from process.env — no secrets in source (PRD §0.3, §8).
 */

export { buildParcelTiles } from './build.js';
export type { BuildParcelTilesOptions, BuildParcelTilesResult } from './build.js';

export { buildBoundaryTiles } from './geoBoundaries.js';
export type { BuildBoundaryTilesOptions, BuildBoundaryTilesResult } from './geoBoundaries.js';

export type { StorageConfig, TileUploadResult } from './storage.js';
