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
  /** Class (b) lenses (forward-accruing, state-derived) are labeled in UI. */
  metric_class: 'a_backfillable' | 'b_forward_accruing';
  legend: { min: number | null; median: number | null; max: number | null; unit: string };
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
