/**
 * Geo-id stamping via point-in-polygon (PRD §3.4 / §4.2). Sets neighborhood_id /
 * zip_id / tract_id on the point relations (parcel, crime_incident, service_request)
 * from public.geo_boundary, so the 4-lens scan and geo_metric aggregation are a plain
 * GROUP BY rather than a per-query spatial join.
 *
 * INCREMENTAL by default: only rows whose geo id is still NULL and whose geom is
 * non-null are stamped, so the nightly stamps just the newly-ingested points. A
 * correlated point-in-polygon subquery uses the GIST index on geo_boundary.geom;
 * `order by geo_id limit 1` makes a boundary-edge / overlapping-polygon tie
 * deterministic. `force` re-stamps every row (after a boundary reload).
 *
 * Only canonical relation/column names appear here — no source literal.
 */
import type { GeoType } from '@bandbox/core/contracts';
import type { DbClient } from '../db.js';

/** Canonical (table, geoColumn) pairs that carry stamped geo ids. */
const GEO_COLUMN: Record<GeoType, string> = {
  neighborhood: 'neighborhood_id',
  zip: 'zip_id',
  tract: 'tract_id',
};

/** Point relations that get stamped. All have geom + the three geo id columns. */
export const STAMP_TABLES = [
  'public.parcel',
  'public.crime_incident',
  'public.service_request',
] as const;
export type StampTable = (typeof STAMP_TABLES)[number];

const GEO_TYPES: GeoType[] = ['neighborhood', 'zip', 'tract'];

export interface StampResult {
  table: string;
  geoType: GeoType;
  stamped: number;
}

/**
 * Stamp one (table, geoType). Returns the row count updated. When `force` is false
 * (default) only NULL-geo rows are touched (incremental); when true, every row with a
 * geometry is re-evaluated (use after a boundary reload).
 */
export async function stampGeoColumn(
  db: DbClient,
  table: StampTable,
  geoType: GeoType,
  force = false,
): Promise<number> {
  const col = GEO_COLUMN[geoType];
  const onlyNull = force ? '' : `and t.${col} is null`;
  const rows = (await db.unsafe(
    `with upd as (
       update ${table} t
       set ${col} = (
         select b.geo_id
         from public.geo_boundary b
         where b.geo_type = $1 and ST_Contains(b.geom, t.geom)
         order by b.geo_id
         limit 1
       )
       where t.geom is not null ${onlyNull}
       returning 1
     )
     select count(*)::int as n from upd`,
    [geoType],
  )) as readonly { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/**
 * Stamp every (STAMP_TABLES × geoType). Returns per-pair counts. Order is
 * table-major; each statement is independent + idempotent.
 */
export async function stampAllGeo(db: DbClient, force = false): Promise<StampResult[]> {
  const out: StampResult[] = [];
  for (const table of STAMP_TABLES) {
    for (const geoType of GEO_TYPES) {
      const stamped = await stampGeoColumn(db, table, geoType, force);
      out.push({ table, geoType, stamped });
    }
  }
  return out;
}
