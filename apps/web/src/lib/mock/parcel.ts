/**
 * Mock ParcelDeepDive fixture — shaped EXACTLY like
 * @bandbox/core/contracts `ParcelDeepDive` (PRD §6, GET /api/parcel/:pk).
 *
 * Typed mock data for the design surfaces only. Mirrors the property
 * deep-dive mockup: 1834 E Firth St, Fishtown / 19125, OPA 312015400.
 * Every figure carries a source stamp + source_url back to the public record.
 */
import type { ParcelDeepDive } from '@bandbox/core/contracts';
import { firthStComps } from './comps';
import { firthStDistress } from './distress';

const ATLAS = (pk: string) => `https://atlas.phila.gov/${pk}`;

export const firthStDeepDive: ParcelDeepDive = {
  parcel: {
    parcel_pk: '312015400',
    pin: '1001523874',
    address: '1834 E FIRTH ST',
    zip: '19125',
    // coords live in geometry server-side; surfaced read-only for the header line
    lat: 39.9759,
    lon: -75.1283,
    market_value: 241400,
    sale_price: 129000,
    sale_date: '2014-04-18',
    year_built: 1915,
    beds: 2,
    livable_area: 1140,
    category_code: '1', // residential
    zoning: 'RSA-5',
    owner_1: 'KOWALCZYK MARGARET (EST)',
    owner_2: null,
    mailing_address: '88 SEA GRAPE LN, NAPLES FL',
    is_out_of_state_owner: true,
    neighborhood_id: 'fishtown',
    neighborhood_name: 'Fishtown',
    zip_id: '19125',
    tract_id: '42101015800',
  },
  assessment_vs_sale: {
    market_value: {
      value: 241400,
      source_stamp: '[OPA · 2026-06-12]',
      source_url: ATLAS('312015400'),
      refreshed_at: '2026-06-12',
    },
    last_sale: {
      value: 129000,
      source_stamp: '[RECORDS DEPT · RTT]',
      source_url: ATLAS('312015400'),
      refreshed_at: '2026-06-07',
    },
    assessed_psf: {
      value: 211,
      source_stamp: '[OPA · 2026-06-12]',
      source_url: ATLAS('312015400'),
      refreshed_at: '2026-06-12',
    },
    // PERCENT units (matches lib/parcel-query producer): (241400-129000)/129000.
    change_since_sale_pct: 87.1,
  },
  transfers: [
    {
      transfer_id: 't-2014-04',
      document_type: 'DEED',
      recording_date: '2014-04-18',
      total_consideration: 129000,
      is_sheriff: false,
      is_distress_doc: false,
      is_estate_or_nonmarket: false,
      is_arms_length: true,
      price_to_assessment: 0.97,
      source_stamp: '[RTT]',
    },
    {
      transfer_id: 't-2009-11',
      document_type: 'DEED MISCELLANEOUS',
      recording_date: '2009-11-02',
      total_consideration: 1,
      is_sheriff: false,
      is_distress_doc: false,
      is_estate_or_nonmarket: true,
      is_arms_length: false,
      price_to_assessment: null,
      source_stamp: '[RTT]',
    },
    {
      transfer_id: 't-2003-08',
      document_type: 'DEED SHERIFF',
      recording_date: '2003-08-14',
      total_consideration: 41500,
      is_sheriff: true,
      is_distress_doc: true,
      is_estate_or_nonmarket: false,
      is_arms_length: false,
      price_to_assessment: null,
      source_stamp: "[SHERIFF '03]",
    },
  ],
  li: [
    {
      kind: 'permit',
      type_code: 'ALTERATION',
      status: 'open',
      date: '2025-10-02',
      source_stamp: "[L&I '25]",
    },
    {
      kind: 'violation',
      type_code: 'UNSAFE',
      status: 'open',
      date: '2024-07-19',
      source_stamp: "[L&I '24]",
    },
    {
      kind: 'violation',
      type_code: 'PM-MAINT',
      status: 'closed',
      date: '2023-03-11',
      source_stamp: '[L&I]',
    },
    {
      kind: 'violation',
      type_code: 'PM-EXTERIOR',
      status: 'closed',
      date: '2022-09-08',
      source_stamp: '[L&I]',
    },
  ],
  tax: {
    billed: {
      value: 3378,
      source_stamp: '[REV]',
      source_url: ATLAS('312015400'),
      refreshed_at: '2026-06-15',
    },
    status: 'delinquent',
    balance_with_penalty: {
      value: 7910,
      source_stamp: '[REV]',
      source_url: ATLAS('312015400'),
      refreshed_at: '2026-06-15',
    },
    sheriff_sale_flag: false,
  },
  nearby: {
    crime: {
      window_label: 'within 0.25 mi · 12 mo',
      count: 64,
      trend: [9, 7, 8, 6, 5, 4, 6, 5, 4, 3, 4, 3],
    },
    service_requests: {
      window_label: 'within 0.25 mi · 12 mo',
      count: 138,
      trend: [14, 12, 13, 11, 12, 10, 11, 12, 10, 11, 12, 10],
    },
  },
  comps: firthStComps,
  distress: firthStDistress,
};

/** Lookup by parcel key for the dynamic /parcel/[pk] route. */
export const deepDiveByPk: Record<string, ParcelDeepDive> = {
  '312015400': firthStDeepDive,
};

export function getDeepDive(pk: string): ParcelDeepDive {
  return deepDiveByPk[pk] ?? firthStDeepDive;
}
