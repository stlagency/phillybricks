/**
 * Mock CompsResult fixture — shaped EXACTLY like
 * @bandbox/core/contracts `CompsResult` (PRD §5.2).
 *
 * Typed mock data for the design surfaces only. In production this arrives
 * from `GET /api/comps?pk=…` and is embedded in ParcelDeepDive.comps.
 *
 * Mirrors the deep-dive mockup: 4 arms-length comps within 0.3 mi, p5/p95
 * trimmed, median $235/SF, estimate $268k after a −4% condition haircut.
 */
import type { CompsResult } from '@bandbox/core/contracts';

export const firthStComps: CompsResult = {
  subject_pk: '312015400',
  insufficient: false,
  comps: [
    {
      parcel_pk: '312015500',
      address: '1841 E FIRTH ST',
      sale_price: 279000,
      sale_date: '2026-03-15',
      livable_area: 1125,
      price_per_sqft: 248,
      beds: 2,
      year_built: 1915,
      source_stamp: '[RTT]',
      source_url: 'https://atlas.phila.gov/312015500',
      reason: {
        distance_mi: 0.02,
        beds_delta: 0,
        livable_area_pct_delta: -0.013,
        year_built_delta: 0,
        is_median: false,
        near_trim_boundary: false,
        note: 'Same block, same row, 1,125 SF. Sold 03/2026, full reno.',
      },
    },
    {
      parcel_pk: '312044100',
      address: '2014 E SUSQUEHANNA AVE',
      sale_price: 267000,
      sale_date: '2025-11-04',
      livable_area: 1135,
      price_per_sqft: 235,
      beds: 2,
      year_built: 1920,
      source_stamp: '[RTT]',
      source_url: 'https://atlas.phila.gov/312044100',
      reason: {
        distance_mi: 0.2,
        beds_delta: 0,
        livable_area_pct_delta: -0.004,
        year_built_delta: 5,
        is_median: true,
        near_trim_boundary: false,
        note: '0.2 mi north, 1,135 SF, two-story row. The middle of the pack.',
      },
    },
    {
      parcel_pk: '312061200',
      address: '1320 E MONTGOMERY AVE',
      sale_price: 258000,
      sale_date: '2025-09-22',
      livable_area: 1127,
      price_per_sqft: 229,
      beds: 2,
      year_built: 1912,
      source_stamp: '[RTT]',
      source_url: 'https://atlas.phila.gov/312061200',
      reason: {
        distance_mi: 0.28,
        beds_delta: 0,
        livable_area_pct_delta: -0.011,
        year_built_delta: -3,
        is_median: false,
        near_trim_boundary: false,
        note: '0.28 mi, 1,127 SF, unrenovated kitchen — closest in condition.',
      },
    },
    {
      parcel_pk: '312078300',
      address: '1908 E BERKS ST',
      sale_price: 251000,
      sale_date: '2025-08-10',
      livable_area: 1136,
      price_per_sqft: 221,
      beds: 2,
      year_built: 1918,
      source_stamp: '[RTT]',
      source_url: 'https://atlas.phila.gov/312078300',
      reason: {
        distance_mi: 0.3,
        beds_delta: 0,
        livable_area_pct_delta: -0.004,
        year_built_delta: 3,
        is_median: false,
        near_trim_boundary: true,
        note: '0.3 mi west, 1,136 SF. Trimmed p5 outlier just above this.',
      },
    },
  ],
  distribution: {
    p5: 221,
    median: 235,
    p95: 248,
    n_raw: 6,
    n_trimmed: 4,
    trimmed_count: 2,
  },
  ladder: [
    { step: 'base', radius_mi: 0.25, recency_months: 18, resulting_count: 3 },
    { step: 'recency_36mo', radius_mi: 0.25, recency_months: 36, resulting_count: 4 },
  ],
  estimate: {
    estimate: 268000,
    branch: 'livable_area',
    median_price_per_sqft: 235,
    adjustments: [
      { label: 'Condition (open unsafe violation)', factor: -0.04, source_stamp: "[L&I '24]" },
    ],
    derivation:
      '4 arms-length comps within 0.3 mi, p5/p95 trimmed · median $235 / SF × 1,140 SF ' +
      '− 4% condition adjustment for the open unsafe violation = $268k.',
  },
};
