/**
 * Mock neighborhood-detail fixture for the Market Scan right rail.
 *
 * This is NOT a single frozen contract (the scan API returns choropleth
 * features + per-area metrics separately); it's a view-model assembled here
 * from the same shapes the deep-dive uses. The `distress` field reuses the
 * frozen `DistressResult` so the decomposable bar renders identically to the
 * parcel page. In production this composes from `/api/scan` (area metrics +
 * trend) plus the `distress_signal` matview aggregated to the tract.
 */
import type { DistressResult } from '@bandbox/core/contracts';
import type { Sourced } from '@bandbox/core/contracts';

export interface NeighborhoodPill {
  label: string;
  kind: 'danger' | 'neutral' | 'aged';
}

export interface NeighborhoodMetric {
  label: string;
  value: string;
  source_stamp: string;
  title: string;
  emphasis?: 'red' | 'featured';
}

export interface NeighborhoodTrend {
  title: string;
  bars: { year: string; pct: number; highlight?: boolean }[];
  note: string;
  ariaLabel: string;
}

export interface NeighborhoodDetail {
  geo_id: string;
  eyebrow: string;
  name: string;
  /** Tract id + parcel count line (Space Mono). */
  recordLine: string;
  /** Rank sentence shown beside the distress score. */
  rank: string;
  pills: NeighborhoodPill[];
  /** Reuses the frozen DistressResult shape for the decomposable bar. */
  distress: DistressResult;
  metrics: NeighborhoodMetric[];
  trend: NeighborhoodTrend;
  measures: { lead: string; body: string; dottedTerm: string; dottedTitle: string; stamp: string };
  communitySignal: string;
  freshline: string;
  parcelCount: number;
}

const pointBreezeDistress: DistressResult = {
  parcel_pk: 'tract:42101003600',
  score01: 0.73,
  score100: 73,
  weightsVersion: 'distress-weights/2026.1',
  components: [
    {
      component: 'tax_delinquent',
      label: 'Tax-delinquent',
      raw_value: 318,
      raw_display: '318 parcels',
      normalized: 0.86,
      weight: 0.38,
      contribution: 0.38,
      source_stamp: '[OPA · 2026-06-12]',
      source_url: 'https://atlas.phila.gov/?tract=42101003600',
    },
    {
      component: 'vacancy_proxy',
      label: 'Vacant',
      raw_value: 211,
      raw_display: '211 parcels',
      normalized: 0.78,
      weight: 0.29,
      contribution: 0.29,
      source_stamp: "[L&I '23]",
      source_url: 'https://atlas.phila.gov/?tract=42101003600',
    },
    {
      component: 'open_violations',
      label: 'L&I violations',
      raw_value: 140,
      raw_display: '140 open',
      normalized: 0.7,
      weight: 0.21,
      contribution: 0.21,
      source_stamp: "[L&I '24]",
      source_url: 'https://atlas.phila.gov/?tract=42101003600',
    },
    {
      component: 'on_sheriff_list',
      label: 'Sheriff sale',
      raw_value: 42,
      raw_display: '42 scheduled',
      normalized: 0.6,
      weight: 0.12,
      contribution: 0.12,
      source_stamp: "[SHERIFF '25]",
      source_url: 'https://phillysheriff.com/mortgage/',
    },
  ],
};

export const pointBreezeDetail: NeighborhoodDetail = {
  geo_id: 'point-breeze',
  eyebrow: 'South Philadelphia · selected',
  name: 'Point Breeze',
  recordLine: 'TRACT 42101003600 · 2,184 parcels',
  rank: '9th most-distressed of 158 tracts citywide.',
  parcelCount: 2184,
  pills: [
    { label: 'TAX-DELINQUENT 318', kind: 'danger' },
    { label: 'VACANT 211', kind: 'danger' },
    { label: 'L&I 140', kind: 'neutral' },
    { label: "SHERIFF '98", kind: 'aged' },
  ],
  distress: pointBreezeDistress,
  metrics: [
    {
      label: 'Median Sale',
      value: '$268K',
      source_stamp: '[RTT · 2026-05]',
      title: '3-yr arms-length median, OPA + RTT records',
    },
    {
      label: '$ / SF',
      value: '$235',
      source_stamp: '[OPA · 2026-06]',
      title: 'Median price per finished sqft',
      emphasis: 'featured',
    },
    {
      label: 'Vacancy',
      value: '9.7%',
      source_stamp: "[L&I '24]",
      title: 'Vacant share of parcels, L&I',
    },
  ],
  trend: {
    title: 'Tax-delinquent parcels / yr',
    bars: [
      { year: "'21", pct: 84 },
      { year: "'22", pct: 78 },
      { year: "'23", pct: 71 },
      { year: "'24", pct: 65 },
      { year: "'25", pct: 61 },
      { year: "'26", pct: 59, highlight: true },
    ],
    note: "Down 22% since '21 — slow, but the block is digging out.",
    ariaLabel:
      'Tax-delinquent parcels by year: 2021 410, 2022 388, 2023 361, 2024 339, 2025 322, 2026 318. Trend declining.',
  },
  measures: {
    lead: 'What this measures · source',
    body:
      'blends four public records into one 0–100 read. Every figure traces back to its filing.',
    dottedTerm: 'distress score',
    dottedTitle:
      'Weighted blend of tax liens, vacancy, L&I cases and sheriff filings, normalized 0–100.',
    stamp: 'Where this comes from · refreshed 6d ago',
  },
  communitySignal:
    '211 vacant here, 47 already in active rehab this year. Each one finished puts a home back on the block in Point Breeze.',
  freshline: "Public record only. Numbers don't lie — people do. Here's the file.",
};

/** Scan area metric strip values carry provenance like everything else. */
export const pointBreezeSourced: Record<string, Sourced<string>> = {
  medianSale: {
    value: '$268K',
    source_stamp: '[RTT · 2026-05]',
    source_url: 'https://atlas.phila.gov/?tract=42101003600',
    refreshed_at: '2026-05-31',
  },
};
