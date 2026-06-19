/**
 * Scan lens → geo_metric metric mapping + quantile bucketing (PRD §7.1, §5.4).
 *
 * The 4 lenses each read ONE metric from public.geo_metric. These metric names
 * mirror the adapter's `lensMetricSql` (the portable seam) — they are canonical
 * metric names, not Philly source literals. `metric_class` lets the UI label the
 * forward-accruing (class-b) lenses "tracking since …".
 */
import type { LensMetric } from '@bandbox/core/contracts';

export interface LensMeta {
  metric: string;
  unit: string;
  /** geo_metric.metric_class is authoritative; this is the documented expectation. */
  metricClass: 'a_backfillable' | 'b_forward_accruing';
}

export const LENS_METRIC: Record<LensMetric, LensMeta> = {
  price: { metric: 'median_price_per_sqft', unit: '$/SF', metricClass: 'a_backfillable' },
  momentum: { metric: 'permit_count', unit: 'permits', metricClass: 'a_backfillable' },
  distress: { metric: 'distress_share', unit: 'score', metricClass: 'b_forward_accruing' },
  livability: { metric: 'livability_index', unit: 'index', metricClass: 'b_forward_accruing' },
};

export const LENSES: LensMetric[] = ['price', 'momentum', 'distress', 'livability'];

export function isLens(x: string | null): x is LensMetric {
  return x === 'price' || x === 'momentum' || x === 'distress' || x === 'livability';
}

export type GeoType = 'zip' | 'neighborhood' | 'tract';
export function isGeoType(x: string | null): x is GeoType {
  return x === 'zip' || x === 'neighborhood' || x === 'tract';
}

/**
 * Assign each value a quantile bucket 0..4 for the 5-stop choropleth ramp. Buckets
 * are by RANK (quintiles) so each lens spreads color evenly regardless of skew;
 * nulls bucket to 0. Returns a parallel array of buckets.
 */
export function quantileBuckets(values: (number | null)[]): number[] {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v))
    .sort((a, b) => a.v - b.v);
  const n = present.length;
  const bucket = new Array(values.length).fill(0);
  if (n === 0) return bucket;
  present.forEach((x, rank) => {
    // rank ∈ [0, n-1] → bucket ∈ [0,4]
    const b = n === 1 ? 2 : Math.min(4, Math.floor((rank / (n - 1)) * 5 - 1e-9));
    bucket[x.i] = b < 0 ? 0 : b;
  });
  return bucket;
}

/** Median of a numeric array (linear interpolation), or null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return lo === hi ? s[lo]! : (s[lo]! + s[hi]!) / 2;
}
