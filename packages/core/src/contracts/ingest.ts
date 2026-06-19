/**
 * Canonical-mapping contract (PRD §2.1, §3.1, §4.2) — the portability seam for
 * INGESTION column-maps.
 *
 * The per-source mapping from RAW source columns → canonical table columns is, by
 * definition, city-specific (it names `opa_account_num`, `permitnumber`, …). The
 * portability gate forbids those literals anywhere but `packages/core/src/adapters/`,
 * so the mapping LOGIC lives in the adapter and the ingestion engine consumes it
 * through this generic contract — the engine never names a source literal.
 *
 * A `mapRow` returns a record of {canonicalColumn → value}. A value is either a
 * primitive (string/number/boolean/null — the server casts text→date/numeric/etc.
 * on insert) or a `GeomMarker` (geometry that must be materialized as a SQL
 * expression, never a plain bound value). Returning `null` from `mapRow` SKIPS the
 * row (e.g. structurally unusable). Coercion + geom-marker helpers live in
 * `@bandbox/core` (`ingest/mapping`) so the adapter and the engine agree.
 *
 * FROZEN CONTRACT: extend additively.
 */

/**
 * A geometry value the loader must turn into a SQL expression (not a bound scalar).
 * `format` selects the materialization:
 *   - 'ewkt'    → ST_Transform(ST_GeomFromEWKT($n), 4326)  — carries its own SRID
 *                 (e.g. OPA bulk `shape` is `SRID=2272;POINT(...)`; transform to 4326).
 *   - 'wkt'     → ST_SetSRID(ST_GeomFromText($n), 4326)    — plain WKT already in 4326.
 *   - 'geojson' → ST_SetSRID(ST_GeomFromGeoJSON($n), 4326) — Carto ST_AsGeoJSON output.
 * A null/empty `value` materializes as `NULL::geometry`.
 */
export interface GeomMarker {
  readonly __geom: 'ewkt' | 'wkt' | 'geojson';
  readonly value: string | null;
}

/** A mapped canonical value: a bound primitive or a geometry marker. */
export type MappedValue = string | number | boolean | null | GeomMarker;

/** The mapped canonical row: {canonicalColumn → value}. Missing columns ⇒ NULL. */
export type MappedRow = Record<string, MappedValue>;

/**
 * Declarative per-source canonical mapping. Lives on the adapter (the only place
 * Philly source literals may appear) and is consumed by the generic upsert engine.
 */
export interface SourceMapping {
  /** Fully-qualified canonical target table (our name, e.g. 'public.parcel'). */
  targetTable: string;
  /** Ordered canonical columns this source writes. */
  targetColumns: string[];
  /** ON CONFLICT target column(s) (the primary key / unique grain). */
  conflictColumns: string[];
  /**
   * Columns to overwrite on conflict. Defaults to all non-conflict columns; pass
   * [] for append-only (ON CONFLICT DO NOTHING).
   */
  updateColumns?: string[];
  /**
   * Map ONE raw source row to canonical values. Return `null` to SKIP the row
   * (structurally unusable — e.g. no stable id). Values absent from the returned
   * record are inserted as NULL.
   */
  mapRow(raw: Record<string, unknown>): MappedRow | null;
}
