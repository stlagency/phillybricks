/**
 * Source fetchers (PRD §4.1, §4.2) — turn a `SourceSpec` into a `StagedBatch`.
 *
 * Two transports:
 *   - Carto keyset: pages from `ops.source_cursor.last_cartodb_id` forward, bounded
 *     by a per-run page budget (memory + wall-clock), applying the adapter's window
 *     predicate. Carries the keyset high-water so the orchestrator advances the
 *     cursor AFTER a successful promote (crash ⇒ re-fetch the un-promoted delta).
 *   - OPA bulk: HEAD for freshness (Last-Modified vs the stored watermark), then
 *     stream-parse the CSV and enforce the row-count band. A not-newer object yields
 *     an EMPTY batch (a clean no-op skip — never a retire-everything trigger); a
 *     truncated/out-of-band download THROWS (the orchestrator alerts + moves on).
 *
 * Both inject their transport so the default test suite stays offline.
 */
import type { SourceSpec } from '@bandbox/core/contracts';
import type { DbClient } from './db.js';
import type { StagedBatch } from './pipeline.js';
import type { SourceFetcher } from './run.js';
import { iterateCartoPages, type FetchLike } from './adapters/carto.js';
import { readSourceCursor } from './ingestRun.js';
import {
  evaluateOpaFreshness,
  evaluateOpaRowCount,
  fetchOpaHttp,
  streamOpaRows,
  type OpaHttp,
} from './adapters/opaBulk.js';

/** Default per-run Carto page budget (rows ≈ pages × pageSize). Bounds memory + time. */
export const DEFAULT_MAX_PAGES = 40;

export interface CartoFetchOptions {
  /** Injected HTTP transport (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Max keyset pages to pull in one run (nightly delta bound). */
  maxPages?: number;
}

/** True when a fetched spatial row carries a usable GeoJSON geometry. */
function hasGeoJson(row: Record<string, unknown>): boolean {
  const g = row.geom_geojson;
  return typeof g === 'string' && g.trim().length > 0;
}

/**
 * Carto keyset fetcher: resumes from the source cursor, pulls up to `maxPages`,
 * applies the adapter window predicate, and reports the keyset high-water. For
 * spatial sources it also counts geometry-valid rows (the gate validates that, not
 * a parcel join).
 */
export function makeCartoFetcher(opts: CartoFetchOptions = {}): SourceFetcher {
  return async (spec: SourceSpec, db: DbClient): Promise<StagedBatch> => {
    const cursorState = await readSourceCursor(db, spec.name);
    const start = cursorState?.lastCartodbId ?? null;
    const isSpatial = spec.expectedJoinRate === undefined;

    const rows: Record<string, unknown>[] = [];
    let nextCursor: number | null = start;
    let geomValidCount = 0;

    for await (const page of iterateCartoPages<Record<string, unknown>>({
      endpoint: spec.endpoint,
      table: spec.name,
      cursorColumn: spec.cursorColumn ?? 'cartodb_id',
      pageSize: spec.pageSize ?? 10_000,
      geometryMode: spec.geometryMode ?? 'none',
      where: spec.windowPredicate,
      startCursor: start,
      maxPages: opts.maxPages ?? DEFAULT_MAX_PAGES,
      fetchImpl: opts.fetchImpl,
    })) {
      for (const r of page.rows) {
        rows.push(r);
        if (isSpatial && hasGeoJson(r)) geomValidCount += 1;
      }
      if (page.nextCursor !== null) nextCursor = page.nextCursor;
    }

    const batch: StagedBatch = { source: spec.name, rows, nextCursor };
    if (isSpatial) batch.geomValidCount = geomValidCount;
    return batch;
  };
}

export interface OpaFetchOptions {
  /** Injected HTTP transport (defaults to fetchOpaHttp()). */
  http?: OpaHttp;
}

/**
 * OPA bulk fetcher (PRD §3.1). Freshness-gates on Last-Modified vs the stored
 * watermark; an unchanged object returns an EMPTY batch (clean skip). Streams the
 * CSV without buffering the file, then enforces the row-count band (±5% of ~583,617)
 * — a violation THROWS so a truncated download never promotes (and never triggers a
 * spurious mass soft-retire downstream).
 */
export function makeOpaFetcher(opts: OpaFetchOptions = {}): SourceFetcher {
  return async (spec: SourceSpec, db: DbClient): Promise<StagedBatch> => {
    const http = opts.http ?? fetchOpaHttp();
    const cursorState = await readSourceCursor(db, spec.name);
    const lastRunLastModifiedMs =
      cursorState?.watermark != null ? Date.parse(cursorState.watermark) || null : null;

    const head = await http.head(spec.endpoint);
    const freshness = evaluateOpaFreshness({ head, lastRunLastModifiedMs });
    const watermark = head.lastModifiedMs != null ? new Date(head.lastModifiedMs).toISOString() : null;

    if (!freshness.fresh && freshness.reason === 'not_newer') {
      // Nothing new — clean no-op. Empty batch ⇒ no promote, no soft-retire.
      return { source: spec.name, rows: [], watermark };
    }

    const stream = await http.getStream(spec.endpoint);
    const rows: Record<string, unknown>[] = [];
    for await (const rec of streamOpaRows(stream)) rows.push(rec);

    const rowCount = evaluateOpaRowCount(rows.length);
    if (!rowCount.ok) {
      throw new Error(
        `OPA row count ${rowCount.rows} outside band [${rowCount.low}, ${rowCount.high}] — refusing to promote a likely-truncated download`,
      );
    }
    return { source: spec.name, rows, watermark };
  };
}
