/**
 * One-time geographic boundary loader (PRD §3.4 / §4.2). Fills public.geo_boundary
 * (zip, Azavea neighborhoods, census tracts) from the adapter's `geoSources` — the
 * polygons the scan colors per lens AND the point-in-polygon source for stamping
 * geo ids onto parcels / crime / 311 (geoStamp.ts).
 *
 * Generic: it consumes `GeoSourceSpec[]` (the Philly URLs + id/name fields live in the
 * adapter, behind the portability seam) and never names a source literal. Geometry is
 * ST_Multi'd into MultiPolygon(4326) so the single column accepts the neighborhood
 * MultiPolygons AND the ZIP/tract Polygons. Idempotent: upsert on (geo_type, geo_id).
 */
import type { GeoSourceSpec } from '@bandbox/core/contracts';
import type { DbClient } from '../db.js';

/** A minimal GeoJSON FeatureCollection shape (only what we read). */
interface FeatureCollection {
  type: string;
  features: {
    type: string;
    properties: Record<string, unknown> | null;
    geometry: unknown | null;
  }[];
}

export interface LoadBoundaryResult {
  kind: string;
  url: string;
  inserted: number;
  skipped: number;
}

/** True when public.geo_boundary has no rows (so the nightly can lazily load once). */
export async function geoBoundaryIsEmpty(db: DbClient): Promise<boolean> {
  const rows = (await db.unsafe(
    `select 1 from public.geo_boundary limit 1`,
  )) as readonly unknown[];
  return rows.length === 0;
}

/** Fetch one boundary source's GeoJSON (follows the ArcGIS hub redirects). */
async function fetchFeatureCollection(url: string): Promise<FeatureCollection> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { accept: 'application/json,application/geo+json,*/*' },
  });
  if (!res.ok) throw new Error(`geo boundary fetch ${url} → HTTP ${res.status}`);
  const json = (await res.json()) as FeatureCollection;
  if (!json || !Array.isArray(json.features)) {
    throw new Error(`geo boundary fetch ${url} → not a FeatureCollection`);
  }
  return json;
}

/**
 * Load one GeoSourceSpec into public.geo_boundary. Each feature's `idField` becomes
 * geo_id (skipped when absent), `nameField` (if any) becomes name, geometry is parsed
 * via ST_GeomFromGeoJSON + ST_Multi. Upsert on (geo_type, geo_id) → idempotent re-run.
 */
export async function loadGeoBoundarySource(
  db: DbClient,
  spec: GeoSourceSpec,
): Promise<LoadBoundaryResult> {
  const fc = await fetchFeatureCollection(spec.url);
  let inserted = 0;
  let skipped = 0;

  for (const f of fc.features) {
    const props = f.properties ?? {};
    const idRaw = props[spec.idField];
    const geoId = idRaw === null || idRaw === undefined ? '' : String(idRaw).trim();
    if (geoId.length === 0 || f.geometry == null) {
      skipped += 1;
      continue;
    }
    const name =
      spec.nameField && props[spec.nameField] != null
        ? String(props[spec.nameField]).trim()
        : geoId;
    const geomJson = JSON.stringify(f.geometry);
    await db.unsafe(
      `insert into public.geo_boundary (geo_type, geo_id, name, geom)
       values ($1, $2, $3, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)))
       on conflict (geo_type, geo_id) do update
         set name = excluded.name, geom = excluded.geom`,
      [spec.kind, geoId, name, geomJson],
    );
    inserted += 1;
  }
  return { kind: spec.kind, url: spec.url, inserted, skipped };
}

/** Load every adapter geo source. Returns a per-source report. */
export async function loadGeoBoundaries(
  db: DbClient,
  geoSources: readonly GeoSourceSpec[],
): Promise<LoadBoundaryResult[]> {
  const results: LoadBoundaryResult[] = [];
  for (const spec of geoSources) {
    results.push(await loadGeoBoundarySource(db, spec));
  }
  return results;
}
