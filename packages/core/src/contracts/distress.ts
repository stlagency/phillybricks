/**
 * Distress scoring contract (PRD §5.3). FROZEN — this exact shape is rendered
 * on the parcel page AND returned by the API (§6). "One opinionated lens";
 * raw overlays always available; the composite is fully decomposable.
 */

/** The raw, individually-toggleable signals (PRD §5.3). */
export type DistressComponentKey =
  | 'tax_delinquent'
  | 'actionable_sheriff_flag'
  | 'open_violations'
  | 'unsafe_or_imm_dang'
  | 'recent_complaints'
  | 'on_sheriff_list'
  | 'out_of_state_owner'
  | 'vacancy_proxy'
  | 'below_market_last_sale';

/**
 * One row of the decomposition. The parcel page renders these; the API returns
 * an array of them. `normalized` ∈ [0,1]; `contribution = weight * normalized`
 * (on the 0–1 scale; the page may present score and contributions ×100).
 */
export interface DistressComponent {
  component: DistressComponentKey;
  /** Human label for UI (e.g. "Tax-delinquent"). */
  label: string;
  /** The underlying public-record value, untransformed (e.g. dollars, counts). */
  raw_value: number | boolean | null;
  /** Display form of raw_value with units (e.g. "$7,910 owed", "3 open"). */
  raw_display: string;
  /** Documented 0–1 transform of raw_value. */
  normalized: number;
  /** Versioned weight; Σ weight over present components = 1. */
  weight: number;
  /** weight × normalized, bounded [0,1]. */
  contribution: number;
  /** Click-through to the originating public record. */
  source_url: string;
  /** Inline source stamp text, e.g. "[REV · 2026-06-15]". */
  source_stamp: string;
}

/**
 * Full distress result for a parcel. `score01` ∈ [0,1] = Σ contribution;
 * `score100` = round(score01 × 100) for display. `weightsVersion` ties the
 * result to the versioned config in packages/core that produced it.
 */
export interface DistressResult {
  parcel_pk: string;
  score01: number;
  score100: number;
  components: DistressComponent[];
  weightsVersion: string;
}
