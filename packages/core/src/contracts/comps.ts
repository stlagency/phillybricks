/**
 * Comps + transparent value estimate contract (PRD §5.2). Arms-length only,
 * N≥5 widening ladder, p5/p95 trim, land branch when livable_area is null/zero.
 * Every comp is annotated with WHY it was selected. FROZEN.
 */

/** Why a comp was selected — drives the "why this comp" UI flag. */
export interface CompReason {
  distance_mi: number;
  beds_delta: number | null;
  livable_area_pct_delta: number | null;
  year_built_delta: number | null;
  /** True if this comp is the median of the trimmed set. */
  is_median: boolean;
  /** True if this comp sits just inside a trim boundary (surfaced as context). */
  near_trim_boundary: boolean;
  /** Plain-English, South-Philly-voiced one-liner. */
  note: string;
}

export interface Comp {
  parcel_pk: string;
  address: string;
  sale_price: number;
  sale_date: string;
  livable_area: number | null;
  price_per_sqft: number | null;
  beds: number | null;
  year_built: number | null;
  reason: CompReason;
  source_stamp: string;
  source_url: string;
}

/** Which rung of the deterministic widening ladder produced the set (PRD §5.2). */
export interface WideningStep {
  step:
    | 'base'
    | 'recency_36mo'
    | 'radius_ring'
    | 'drop_year_band'
    | 'drop_beds_band';
  radius_mi?: number;
  recency_months?: number;
  resulting_count: number;
}

export type EstimateBranch = 'livable_area' | 'land';

export interface ValueEstimate {
  /** null ⇒ insufficient comps; UI renders the explicit empty state. */
  estimate: number | null;
  branch: EstimateBranch;
  median_price_per_sqft: number | null;
  /** e.g. -0.04 for a 4% condition haircut; operands link to source. */
  adjustments: { label: string; factor: number; source_stamp: string }[];
  /** Plain-English derivation string, each operand dotted to its source. */
  derivation: string;
}

export interface CompsResult {
  subject_pk: string;
  comps: Comp[];
  /** Distribution of $/sqft AFTER p5/p95 trim. */
  distribution: {
    p5: number | null;
    median: number | null;
    p95: number | null;
    n_raw: number;
    n_trimmed: number;
    trimmed_count: number;
  };
  ladder: WideningStep[];
  estimate: ValueEstimate;
  /** True when even the widest ladder rung stayed below N≥5. */
  insufficient: boolean;
}
