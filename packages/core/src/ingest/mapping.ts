/**
 * Coercion + geometry-marker helpers for adapter column-maps (PRD §3.1, §4.2).
 *
 * These are the PRIMITIVES an adapter's `mapRow` composes to turn a raw source row
 * into a canonical `MappedRow`. They are pure and city-agnostic — the city-specific
 * part (which raw column feeds which canonical column) lives in the adapter that
 * calls them. The ingestion engine binds primitives as `$N` params and lets the
 * server cast text→date/numeric/timestamptz from the target column type; geometry is
 * the one exception (materialized as a SQL expression via `GeomMarker`).
 */
import type { GeomMarker } from '../contracts/ingest.js';

/** Trimmed text, or null for null/undefined/empty. */
export function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

/** Finite number, or null. Strips `$` and thousands separators so CSV money parses. */
export function asNumeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[$,]/g, '');
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Integer (truncated toward zero), or null. */
export function asInt(v: unknown): number | null {
  const n = asNumeric(v);
  return n === null ? null : Math.trunc(n);
}

/** Date/timestamp text passed through for the column's date/timestamptz cast, or null. */
export function asDate(v: unknown): string | null {
  return asText(v);
}

/** int/float source id (e.g. OPA `pin`) rendered as canonical text, or null. */
export function asIdText(v: unknown): string | null {
  return asText(v);
}

/**
 * Boolean from a source 'true'/'false' TEXT column (case-insensitive). Anything
 * not equal to 'true' (incl. null/empty) ⇒ false. Use for OPA tax `is_actionable`,
 * `payment_agreement` — which are TEXT, not real booleans.
 */
export function boolFromTrueFalse(v: unknown): boolean {
  return String(v ?? '').trim().toLowerCase() === 'true';
}

/**
 * Boolean from a source 'Y'/'N' TEXT column. Only 'Y' (case-insensitive) ⇒ true.
 * DISTINCT encoding from `boolFromTrueFalse` — e.g. tax `sheriff_sale` is 'Y'/'N'.
 */
export function boolFromYN(v: unknown): boolean {
  return String(v ?? '').trim().toUpperCase() === 'Y';
}

/** Boolean from a source 'Yes'/'No' TEXT column. Only 'Yes' (case-insensitive) ⇒ true. */
export function boolFromYesNo(v: unknown): boolean {
  return String(v ?? '').trim().toLowerCase() === 'yes';
}

// ── geometry markers (interpreted by the ingestion upsert engine) ──────────────

/**
 * EWKT geometry that carries its own SRID; the loader transforms it to 4326
 * (`ST_Transform(ST_GeomFromEWKT($n), 4326)`). Use for the OPA bulk `shape` column,
 * which is `SRID=2272;POINT(...)` (PA State Plane). Empty/whitespace ⇒ NULL geometry.
 */
export function ewktGeom(v: unknown): GeomMarker {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return { __geom: 'ewkt', value: s.length === 0 ? null : s };
}

/** Plain WKT already in 4326 (`ST_SetSRID(ST_GeomFromText($n), 4326)`). */
export function wktGeom(v: unknown): GeomMarker {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return { __geom: 'wkt', value: s.length === 0 ? null : s };
}

/** GeoJSON geometry from Carto `ST_AsGeoJSON` (`ST_SetSRID(ST_GeomFromGeoJSON($n), 4326)`). */
export function geoJsonGeom(v: unknown): GeomMarker {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return { __geom: 'geojson', value: s.length === 0 ? null : s };
}

/** True when `x` is a `GeomMarker` (so the engine renders an expression, not a param). */
export function isGeomMarker(x: unknown): x is GeomMarker {
  return (
    typeof x === 'object' &&
    x !== null &&
    '__geom' in x &&
    typeof (x as { __geom: unknown }).__geom === 'string'
  );
}
