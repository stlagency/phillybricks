/**
 * End-of-nightly derived finalize (PRD §3.4 / §4.1). Runs ONCE after every source has
 * promoted — not per-source — so the two population matviews are refreshed once, not
 * 14× a night. The §4.1 "refresh derived only after promote" invariant holds because
 * finalize runs strictly after the source loop (run.ts main()).
 *
 * Ordered for correctness (each step feeds the next):
 *   1. geo_boundary  — load once if empty (the polygons everything geo depends on).
 *   2. geo-stamp     — point-in-polygon neighborhood/zip/tract ids onto parcel /
 *                      crime / 311 (incremental; force after a fresh boundary load).
 *   3. comp_candidate refresh — needs parcels' neighborhood_id (just stamped).
 *   4. distress_signal refresh — reads comp_candidate (neighborhood median $/sqft for
 *                      the below-market proxy) + parcels' neighborhood_id.
 *   5. geo_metric    — distress_share reads distress_signal; the rest read canonical.
 *
 * Matview refresh is CONCURRENTLY once populated (non-blocking, PRD §3.4); a never-yet-
 * populated matview (e.g. the first run after 0011 recreated it WITH NO DATA) needs a
 * one-time non-concurrent populate first. The worker now OWNS the matviews (0011), so
 * it can refresh them directly — CONCURRENTLY may not run inside a function/transaction,
 * so each refresh is a bare autocommit statement (never wrapped in db.begin()).
 */
import { philadelphia } from '@bandbox/core';
import type { DbClient } from './db.js';
import { geoBoundaryIsEmpty, loadGeoBoundaries, type LoadBoundaryResult } from './loaders/geoBoundary.js';
import { stampAllGeo, type StampResult } from './loaders/geoStamp.js';
import { recomputeGeoMetrics, type RecomputeGeoMetricsResult } from './loaders/geoMetric.js';

/** Matviews the worker refreshes, in dependency order (comp_candidate before distress). */
export const REFRESH_MATVIEWS = ['comp_candidate', 'distress_signal'] as const;
export type RefreshMatview = (typeof REFRESH_MATVIEWS)[number];

/** Is the matview populated? (false for a freshly (re)created WITH NO DATA matview.) */
async function isPopulated(db: DbClient, name: RefreshMatview): Promise<boolean> {
  const rows = (await db.unsafe(
    `select c.relispopulated as populated
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1`,
    [name],
  )) as readonly { populated: boolean }[];
  return rows[0]?.populated === true;
}

/**
 * Refresh one matview — CONCURRENTLY when already populated (non-blocking), else a
 * one-time non-concurrent populate. Returns which path ran. `name` is from the fixed
 * REFRESH_MATVIEWS allowlist (never user input), so interpolation is safe.
 */
export async function refreshMatview(
  db: DbClient,
  name: RefreshMatview,
): Promise<'concurrent' | 'full'> {
  if (!REFRESH_MATVIEWS.includes(name)) throw new Error(`refusing to refresh unknown matview: ${name}`);
  if (await isPopulated(db, name)) {
    await db.unsafe(`refresh materialized view concurrently public.${name}`);
    return 'concurrent';
  }
  await db.unsafe(`refresh materialized view public.${name}`);
  return 'full';
}

export interface FinalizeDerivedOptions {
  /** Full historical geo_metric backfill (class-a). The nightly leaves this false. */
  backfill?: boolean;
  /** Trailing months recomputed for class-(a) geo_metric on a nightly (default 3). */
  trailingMonths?: number;
  /** Force a full geo re-stamp even when boundaries already existed. */
  forceStamp?: boolean;
  log?: (msg: string) => void;
}

export interface FinalizeDerivedResult {
  boundariesLoaded: LoadBoundaryResult[] | null;
  stamps: StampResult[];
  refreshes: Record<RefreshMatview, 'concurrent' | 'full'>;
  geoMetric: RecomputeGeoMetricsResult;
}

/**
 * Run the full derived finalize. Idempotent end-to-end (lazy boundary load, incremental
 * stamp, upserted geo_metric, matview refresh). Returns a report for the run log.
 */
export async function finalizeDerived(
  db: DbClient,
  opts: FinalizeDerivedOptions = {},
): Promise<FinalizeDerivedResult> {
  const log = opts.log ?? ((m: string) => console.log(m));

  // 1. geo_boundary — load once if empty.
  let boundariesLoaded: LoadBoundaryResult[] | null = null;
  if (await geoBoundaryIsEmpty(db)) {
    boundariesLoaded = await loadGeoBoundaries(db, philadelphia.geoSources);
    log(
      `geo_boundary loaded: ${boundariesLoaded
        .map((r) => `${r.kind}=${r.inserted}`)
        .join(', ')}`,
    );
  }

  // 2. geo-stamp (force after a fresh boundary load — every row must be re-evaluated).
  const force = opts.forceStamp ?? boundariesLoaded !== null;
  const stamps = await stampAllGeo(db, force);
  log(
    `geo-stamp${force ? ' (force)' : ''}: ` +
      stamps.map((s) => `${s.table.replace('public.', '')}/${s.geoType}=${s.stamped}`).join(', '),
  );

  // 3 + 4. refresh matviews (comp_candidate, then distress_signal).
  const refreshes = {} as Record<RefreshMatview, 'concurrent' | 'full'>;
  for (const name of REFRESH_MATVIEWS) {
    refreshes[name] = await refreshMatview(db, name);
    log(`refresh ${name}: ${refreshes[name]}`);
  }

  // 5. geo_metric (distress_share reads distress_signal, refreshed above).
  const geoMetric = await recomputeGeoMetrics(db, {
    backfill: opts.backfill,
    trailingMonths: opts.trailingMonths,
    log,
  });

  return { boundariesLoaded, stamps, refreshes, geoMetric };
}
