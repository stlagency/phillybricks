/**
 * Rebuild the frozen DistressResult decomposition from a public.distress_signal row
 * (PRD §5.3, §6). The matview stores the 9 RAW signals + the composite; the API
 * recomputes the per-component decomposition via the same scoreDistress() the SQL
 * composite was generated from — single source of truth, no duplicated weights.
 *
 * IMPORTANT: postgres.js returns numeric/bigint columns as STRINGS; scoreDistress's
 * normalizer treats a non-number as absent (→ 0). We coerce the four numeric signals
 * to Number first (booleans arrive as real booleans).
 */
import { scoreDistress } from '@bandbox/core';
import type { DistressComponentKey } from '@bandbox/core/contracts';
import type { DistressResult } from '@bandbox/core/contracts';

const NUMERIC: DistressComponentKey[] = [
  'tax_delinquent',
  'open_violations',
  'recent_complaints',
  'below_market_last_sale',
];
const ALL: DistressComponentKey[] = [
  'tax_delinquent',
  'actionable_sheriff_flag',
  'open_violations',
  'unsafe_or_imm_dang',
  'recent_complaints',
  'on_sheriff_list',
  'out_of_state_owner',
  'vacancy_proxy',
  'below_market_last_sale',
];

export type DistressSignalRow = Record<string, unknown> & { parcel_pk: string };

/** Map a distress_signal matview row → DistressResult (the §5.3 decomposition shape). */
export function distressFromRow(row: DistressSignalRow): DistressResult {
  const signals: Partial<Record<DistressComponentKey, number | boolean | null>> = {};
  for (const key of ALL) {
    const v = row[key];
    if (v === null || v === undefined) signals[key] = null;
    else if (NUMERIC.includes(key)) signals[key] = Number(v);
    else signals[key] = Boolean(v);
  }
  return scoreDistress({ parcel_pk: String(row.parcel_pk), signals });
}
