/**
 * API response contracts (PRD §6). FROZEN — apps/web routes and the ingestion/db
 * layers share these. Keeps the on-screen distress shape identical to the API's.
 */
import type { DistressResult } from './distress.js';
import type { CompsResult } from './comps.js';
import type { GeoType, LensMetric } from './city-adapter.js';

/** A value that carries its provenance — every figure links to a raw record. */
export interface Sourced<T> {
  value: T;
  source_stamp: string;
  source_url: string;
  /** ISO date the underlying record was last refreshed. */
  refreshed_at: string | null;
}

export interface ParcelCore {
  parcel_pk: string;
  pin: string | null;
  address: string;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  market_value: number | null;
  sale_price: number | null;
  sale_date: string | null;
  year_built: number | null;
  beds: number | null;
  livable_area: number | null;
  category_code: string | null;
  zoning: string | null;
  owner_1: string | null;
  owner_2: string | null;
  mailing_address: string | null;
  is_out_of_state_owner: boolean;
  neighborhood_id: string | null;
  /** Resolved human name for neighborhood_id (geo_boundary), e.g. "Logan". */
  neighborhood_name: string | null;
  zip_id: string | null;
  tract_id: string | null;
}

export interface TransferRow {
  transfer_id: string;
  document_type: string;
  recording_date: string;
  total_consideration: number | null;
  is_sheriff: boolean;
  is_distress_doc: boolean;
  is_estate_or_nonmarket: boolean;
  is_arms_length: boolean;
  price_to_assessment: number | null;
  source_stamp: string;
}

export interface LiRow {
  kind: 'permit' | 'violation' | 'complaint' | 'case_investigation';
  type_code: string | null;
  status: string | null;
  date: string | null;
  source_stamp: string;
}

export interface TaxStatus {
  billed: Sourced<number | null>;
  status: 'current' | 'delinquent' | 'unknown';
  balance_with_penalty: Sourced<number | null>;
  sheriff_sale_flag: boolean;
}

export interface NearbyCounts {
  crime: { window_label: string; count: number; trend: number[] };
  service_requests: { window_label: string; count: number; trend: number[] };
}

/** GET /api/parcel/:pk — the deep-dive bundle. */
export interface ParcelDeepDive {
  parcel: ParcelCore;
  assessment_vs_sale: {
    market_value: Sourced<number | null>;
    last_sale: Sourced<number | null>;
    assessed_psf: Sourced<number | null>;
    change_since_sale_pct: number | null;
  };
  transfers: TransferRow[];
  li: LiRow[];
  tax: TaxStatus;
  nearby: NearbyCounts;
  comps: CompsResult;
  distress: DistressResult;
}

/** GET /api/comps?pk=… */
export type CompsResponse = CompsResult;

/** One geo unit's value for the active lens in the scan. */
export interface ScanFeature {
  geo_id: string;
  geo_type: GeoType;
  name: string;
  value: number | null;
  /** Quantile bucket 0..4 for the choropleth ramp. */
  bucket: number;
}

/** GET /api/scan?geo=&lens=&period= */
export interface ScanResponse {
  geo_type: GeoType;
  lens: LensMetric;
  period: string;
  features: ScanFeature[];
  /** Per-lens available period range so the time control knows the range. */
  period_min: string;
  period_max: string;
  /** Every distinct period (sorted asc) for this lens+geo — the time slider's stops. */
  periods: string[];
  /** Class (b) lenses (forward-accruing, state-derived) are labeled in UI. */
  metric_class: 'a_backfillable' | 'b_forward_accruing';
  legend: { min: number | null; median: number | null; max: number | null; unit: string };
}

/** One metric cell for a geo unit's latest-period detail strip (rail). */
export interface GeoMetricCell {
  metric: string;
  value: number | null;
  unit: string;
  period: string | null;
  sample_size: number | null;
}

/** A per-period point in a geo trend series. */
export interface GeoTrendPoint {
  period: string;
  value: number | null;
}

/** A class-(a) series rolled up for the rail trend chart (e.g. median sale price by year). */
export interface GeoTrend {
  metric: string;
  unit: string;
  points: GeoTrendPoint[];
}

/**
 * GET /api/geo/:type/:id — aggregate detail for ONE geo unit, feeding the Market
 * Scan right rail (PRD §7.1). The distress block is HONEST: `distress.score01`
 * equals the geo's mean parcel distress (== geo_metric `distress_share`) and the
 * component contributions sum to it. `distress_percentile` is the separate
 * rank-based 0..100 index the rail headline shows (consistent with the
 * rank-bucketed choropleth); the web view-model maps it onto the big number.
 */
export interface GeoDetail {
  geo_id: string;
  geo_type: GeoType;
  name: string;
  parcel_count: number;
  /** Distress aggregated to the geo. Σ component contribution = score01 (the real mean). */
  distress: DistressResult;
  /** Rank-based distress index 0..100 (100 = most-distressed of this geo_type). */
  distress_percentile: number;
  /** Distress rank among peers of the same geo_type (1 = most-distressed), or null. */
  rank: { value: number; of: number } | null;
  /** Latest-period metric strip (median sale, $/sqft, shares, …). */
  metrics: GeoMetricCell[];
  /** Headline signal parcel-counts for the rail pill row. */
  signals: { tax_delinquent: number; vacant: number; li_violations: number; sheriff: number };
  /** A class-(a) trend series (by year) for the rail chart. */
  trend: GeoTrend;
  /** Max freshness across the underlying matview/metrics, ISO date or null. */
  computed_at: string | null;
}

/** GET /api/leads — scored, paginated. */
export interface LeadRow {
  parcel_pk: string;
  address: string;
  distress: DistressResult;
  owner_1: string | null;
  is_out_of_state_owner: boolean;
}

export interface LeadsResponse {
  rows: LeadRow[];
  page: number;
  page_size: number;
  total: number;
}

/**
 * GET /api/leads?facets=1 — honest per-signal counts for the filter rail, scoped
 * to the active min_score + neighborhood (so a toggle shows how many leads it
 * would surface). `by_signal` keys are DistressComponentKey signal flags.
 */
export interface LeadFacets {
  total: number;
  by_signal: Record<string, number>;
}

// ── M6: mini-CRM (PRD §3.5, §7.3) — saved leads ──────────────────────────────

/** Canonical lead pipeline statuses for the mini-CRM. */
export type SavedLeadStatus = 'new' | 'contacted' | 'negotiating' | 'dead' | 'won';

/** One app.saved_lead row, owned by the authenticated user. */
export interface SavedLead {
  id: string;
  parcel_pk: string;
  status: SavedLeadStatus;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /api/leads/save body — upsert one saved lead for the current user. */
export interface SaveLeadInput {
  parcel_pk: string;
  status?: SavedLeadStatus;
  tags?: string[];
  notes?: string | null;
}

// ── M6: BYO skip-trace (PRD §6, §7.5, §8) ────────────────────────────────────

/**
 * Skip-trace vendor enum — the ONLY thing that selects a base URL, via a
 * server-side allowlist. A vendor host is NEVER read from the DB or user input
 * (PRD §6 threat model). First targets: BatchData / REISkip / Endato (§11).
 */
export type SkipTraceVendor = 'batchdata' | 'reiskip' | 'endato';

/** Contact data returned to the session only — NEVER persisted server-side. */
export interface SkipTraceContact {
  name: string | null;
  phones: string[];
  emails: string[];
  mailing_address: string | null;
}

/** POST /api/skiptrace/:pk response (transient; not stored, key never logged). */
export interface SkipTraceResult {
  parcel_pk: string;
  vendor: SkipTraceVendor;
  contact: SkipTraceContact;
  /** ISO timestamp of the lookup. */
  looked_up_at: string;
}

// ── M7: accounts + alerts (PRD §3.5, §7) ─────────────────────────────────────

/** The current user's profile + entitlement snapshot (GET /api/account). */
export interface AccountProfile {
  user_id: string;
  email: string | null;
  display_name: string | null;
  /** ISO timestamp of the lawful-use skip-trace attestation, or null. */
  attested_skiptrace_at: string | null;
  /** Whether a BYO skip-trace key is on file (the key itself is never returned). */
  has_skiptrace_key: boolean;
  /** Skip-trace vendor on file, if any. */
  skiptrace_vendor: SkipTraceVendor | null;
}

/** How a saved area's geometry is defined (PRD §3.5). */
export type SavedAreaKind = 'polygon' | 'canonical' | 'radius';

/** One app.saved_area row, owned by the authenticated user. */
export interface SavedArea {
  id: string;
  name: string | null;
  kind: SavedAreaKind;
  created_at: string;
}

/**
 * POST /api/areas body — create a saved area in one of three modes:
 *   polygon   → `geojson` is a GeoJSON Polygon geometry.
 *   canonical → `geo_type` + `geo_id` resolve to a geo_boundary's geometry.
 *   radius    → `center` (lon/lat) + `radius_m` buffer into a circle.
 */
export interface SaveAreaInput {
  name?: string | null;
  kind: SavedAreaKind;
  geojson?: unknown;
  geo_type?: GeoType;
  geo_id?: string;
  center?: { lon: number; lat: number };
  radius_m?: number;
}

/** The alert trigger taxonomy (PRD §3.5). */
export type AlertTriggerType =
  | 'new_transaction'
  | 'new_development'
  | 'new_distress'
  | 'new_matching_lead';

/** One app.alert_subscription row — fires triggers over a saved area. */
export interface AlertSubscription {
  id: string;
  saved_area_id: string | null;
  trigger_types: AlertTriggerType[];
  channel: 'email' | 'in_app';
  frequency: 'daily';
  last_sent_at: string | null;
  created_at: string;
}

/** POST /api/alerts/subscriptions body. */
export interface CreateAlertSubscriptionInput {
  saved_area_id: string;
  trigger_types: AlertTriggerType[];
  channel?: 'email' | 'in_app';
  frequency?: 'daily';
}

/** One materialized alert feed item (app.alert_event), newest-first in the feed. */
export interface AlertEvent {
  id: string;
  parcel_pk: string | null;
  trigger_type: AlertTriggerType;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}
