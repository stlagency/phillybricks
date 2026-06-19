/**
 * Per-source JOIN-RATE gate (PRD §3.1, §4.3) — one of the four correctness gates.
 *
 * The join is EMPIRICAL, not assumed. For each candidate key path of a staged
 * batch we normalize (via the adapter's `normParcelKey`, mirror of SQL
 * `norm_parcel`) and measure the fraction of rows whose normalized key joins to
 * `public.parcel`. The gate compares the BEST candidate path's rate to the
 * source's `expectedJoinRate` baseline:
 *
 *   - below threshold  → quarantine the batch + ALERT, but NEVER halt the run.
 *   - at/above         → pass; promotion proceeds on the best key path.
 *   - spatial source   → `expectedJoinRate` undefined ⇒ EXEMPT from this gate;
 *                        validated by geometry (not-null + point-in-city) instead.
 *
 * Run stats (per-key rates, chosen path, decision) are written to
 * `ops.ingest_run.join_rates`.
 */
import type { CityAdapter, SourceSpec } from '@bandbox/core/contracts';

/** Measured rate for one candidate key column. */
export interface KeyPathRate {
  /** The candidate column, e.g. 'parcel_number' or 'pin'. */
  column: string;
  /** Rows whose value normalized to a non-null 9-digit key. */
  normalizedCount: number;
  /** Of the normalized keys, how many joined to public.parcel. */
  joinedCount: number;
  /** joinedCount / totalRows ∈ [0,1]. The fraction of the WHOLE batch that joins. */
  rate: number;
}

export interface JoinRateMeasurement {
  source: string;
  totalRows: number;
  /** Per-candidate-column rates, in the adapter's priority order. */
  perKey: KeyPathRate[];
  /** Highest-rate column (the path promotion will use). Null when no columns. */
  bestColumn: string | null;
  /** Best column's rate, or 0 when there are no candidate columns / rows. */
  bestRate: number;
}

export type GateDecision =
  | { kind: 'pass'; bestColumn: string | null; bestRate: number; threshold: number }
  | { kind: 'quarantine'; bestColumn: string | null; bestRate: number; threshold: number }
  | { kind: 'exempt_spatial' };

/** The set of normalized 9-digit parcel keys that exist in `public.parcel`. */
export interface ParcelKeyIndex {
  has(normalizedKey: string): boolean;
}

/**
 * Measure the join rate of a staged batch for every candidate key path.
 *
 * `staged` rows are raw source records. `keyColumns` are the candidate parcel-key
 * columns in PRIORITY order (from the SourceSpec). For each column we normalize
 * each row's value and test membership against `parcelIndex`. `rate` is over the
 * WHOLE batch (joined / total), so a column that normalizes few rows scores low —
 * which is what the gate should see.
 */
export function measureJoinRate(
  source: string,
  staged: readonly Record<string, unknown>[],
  keyColumns: readonly string[],
  adapter: CityAdapter,
  parcelIndex: ParcelKeyIndex,
): JoinRateMeasurement {
  const totalRows = staged.length;
  const perKey: KeyPathRate[] = [];

  for (const column of keyColumns) {
    let normalizedCount = 0;
    let joinedCount = 0;
    for (const row of staged) {
      const raw = row[column];
      const key = adapter.normParcelKey(raw == null ? null : String(raw));
      if (key === null) continue;
      normalizedCount += 1;
      if (parcelIndex.has(key)) joinedCount += 1;
    }
    const rate = totalRows === 0 ? 0 : joinedCount / totalRows;
    perKey.push({ column, normalizedCount, joinedCount, rate });
  }

  // First column initializes; thereafter only strictly-better rates win, so ties
  // keep the higher-priority (earlier) candidate column.
  let bestColumn: string | null = null;
  let bestRate = 0;
  for (const k of perKey) {
    if (bestColumn === null || k.rate > bestRate) {
      bestColumn = k.column;
      bestRate = k.rate;
    }
  }

  return { source, totalRows, perKey, bestColumn, bestRate };
}

/**
 * Decide the gate outcome for a measured source.
 *
 * Spatial sources (`expectedJoinRate === undefined`) are EXEMPT — they validate
 * by geometry elsewhere. Otherwise the best candidate path's rate must be `>=`
 * the source threshold to pass; below → quarantine + alert (never halt).
 */
export function evaluateGate(
  spec: Pick<SourceSpec, 'expectedJoinRate'>,
  measurement: JoinRateMeasurement,
): GateDecision {
  if (spec.expectedJoinRate === undefined) return { kind: 'exempt_spatial' };
  const threshold = spec.expectedJoinRate;
  const { bestColumn, bestRate } = measurement;
  const kind = bestRate >= threshold ? 'pass' : 'quarantine';
  return { kind, bestColumn, bestRate, threshold };
}

/**
 * Build the `join_rates` JSONB payload written to `ops.ingest_run`. Captures
 * every candidate path's numbers plus the decision so the gate is fully
 * auditable after the fact.
 */
export function joinRatesPayload(
  measurement: JoinRateMeasurement,
  decision: GateDecision,
): Record<string, unknown> {
  return {
    source: measurement.source,
    total_rows: measurement.totalRows,
    per_key: measurement.perKey.map((k) => ({
      column: k.column,
      normalized: k.normalizedCount,
      joined: k.joinedCount,
      rate: round4(k.rate),
    })),
    best_column: measurement.bestColumn,
    best_rate: round4(measurement.bestRate),
    decision: decision.kind,
    threshold: decision.kind === 'exempt_spatial' ? null : round4(decision.threshold),
  };
}

/** Load the set of normalized parcel keys from `public.parcel` into a Set index. */
export async function loadParcelKeyIndex(db: {
  unsafe<T extends readonly unknown[] = readonly unknown[]>(q: string, p?: unknown[]): Promise<T>;
}): Promise<ParcelKeyIndex> {
  // parcel_pk is already the normalized 9-digit key; pin is the alt join path.
  const rows = (await db.unsafe(
    `select parcel_pk from public.parcel where is_active = true`,
  )) as readonly { parcel_pk: string }[];
  const set = new Set<string>();
  for (const r of rows) set.add(r.parcel_pk);
  return { has: (k) => set.has(k) };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
