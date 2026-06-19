/**
 * Mock DistressResult fixtures — shaped EXACTLY like
 * @bandbox/core/contracts `DistressResult` (PRD §5.3).
 *
 * This is typed mock data for the design surfaces only — no live DB yet.
 * In production these objects arrive from `GET /api/parcel/:pk` (the
 * `distress` field of ParcelDeepDive) and `GET /api/leads` (per-row).
 *
 * The decomposition mirrors the deep-dive mockup: TAX 32 / VAC 22 / VIOL 14
 * = 68. `contribution = weight × normalized` on the 0–1 scale; the page
 * presents score and contributions ×100 (so 0.32 renders as "32").
 */
import type { DistressResult, DistressComponent } from '@bandbox/core/contracts';

const WEIGHTS_VERSION = 'distress-weights/2026.1';

/** 1834 E Firth St, Fishtown — the deep-dive subject (OPA 312015400). */
export const firthStDistress: DistressResult = {
  parcel_pk: '312015400',
  score01: 0.68,
  score100: 68,
  weightsVersion: WEIGHTS_VERSION,
  components: [
    {
      component: 'tax_delinquent',
      label: 'Tax-delinquency',
      raw_value: 7910,
      raw_display: '$7,910 owed',
      normalized: 0.8,
      weight: 0.4,
      contribution: 0.32,
      source_stamp: '[REV · 2026-06-15]',
      source_url: 'https://atlas.phila.gov/312015400',
    },
    {
      component: 'vacancy_proxy',
      label: 'Vacancy',
      raw_value: 3.2,
      raw_display: '3.2 yrs vacant',
      normalized: 0.73,
      weight: 0.3,
      contribution: 0.22,
      source_stamp: '[L&I VACANT · 2026-05]',
      source_url: 'https://atlas.phila.gov/312015400',
    },
    {
      component: 'open_violations',
      label: 'L&I violations',
      raw_value: 1,
      raw_display: '1 open · UNSAFE',
      normalized: 0.7,
      weight: 0.2,
      contribution: 0.14,
      source_stamp: "[L&I '24]",
      source_url: 'https://atlas.phila.gov/312015400',
    },
  ],
};

/** A handful of scored leads (Point Breeze / Fishtown) for the leads list. */
function leadDistress(
  pk: string,
  score100: number,
  components: DistressComponent[],
): DistressResult {
  return {
    parcel_pk: pk,
    score100,
    score01: Number((score100 / 100).toFixed(2)),
    weightsVersion: WEIGHTS_VERSION,
    components,
  };
}

export const leadDistressByPk: Record<string, DistressResult> = {
  '888001100': leadDistress('888001100', 73, [
    {
      component: 'tax_delinquent',
      label: 'Tax-delinquency',
      raw_value: 11240,
      raw_display: '$11,240 owed',
      normalized: 0.88,
      weight: 0.4,
      contribution: 0.35,
      source_stamp: '[REV · 2026-06-12]',
      source_url: 'https://atlas.phila.gov/888001100',
    },
    {
      component: 'on_sheriff_list',
      label: 'On sheriff list',
      raw_value: true,
      raw_display: 'Scheduled · mortgage',
      normalized: 1,
      weight: 0.25,
      contribution: 0.25,
      source_stamp: "[SHERIFF '26]",
      source_url: 'https://phillysheriff.com/mortgage/',
    },
    {
      component: 'out_of_state_owner',
      label: 'Out-of-state owner',
      raw_value: true,
      raw_display: 'Mailing: FL',
      normalized: 1,
      weight: 0.13,
      contribution: 0.13,
      source_stamp: '[OPA · 2026-06]',
      source_url: 'https://atlas.phila.gov/888001100',
    },
  ]),
  '888002200': leadDistress('888002200', 61, [
    {
      component: 'vacancy_proxy',
      label: 'Vacancy',
      raw_value: 5.1,
      raw_display: '5.1 yrs vacant',
      normalized: 0.85,
      weight: 0.34,
      contribution: 0.29,
      source_stamp: '[L&I VACANT · 2026-05]',
      source_url: 'https://atlas.phila.gov/888002200',
    },
    {
      component: 'open_violations',
      label: 'L&I violations',
      raw_value: 3,
      raw_display: '3 open · 1 unsafe',
      normalized: 0.8,
      weight: 0.4,
      contribution: 0.32,
      source_stamp: "[L&I '25]",
      source_url: 'https://atlas.phila.gov/888002200',
    },
  ]),
};
