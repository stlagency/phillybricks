/**
 * Transfer-flag derivation (PRD §5.1). Pure: takes a raw `rtt_summary` row and a
 * `CityAdapter` (for the document-type vocabularies + nominal floor) and returns
 * the four boolean flags + `price_to_assessment`. Flags are derived ON LOAD and
 * stored on `public.transfer` (no document_type literal lives here — they come
 * from the adapter).
 *
 * Arms-length classification is DERIVED, not read from a column: a deed is
 * arms-length only when its document_type is in the arms-length vocab AND
 * consideration clears the nominal floor AND it is neither a distress doc nor an
 * estate/non-market transfer. A $1 estate deed is therefore NOT arms-length.
 */
import type { CityAdapter } from './contracts/index.js';

/**
 * The subset of a raw `rtt_summary` row the flag derivation needs. The source
 * names grantor/grantee fields in the PLURAL and free-text (`grantors`,
 * `grantees`); both single and plural spellings are accepted so callers can pass
 * either the raw source shape or a mapped one.
 */
export interface TransferInput {
  document_type: string | null | undefined;
  total_consideration: number | null | undefined;
  /** Assessment-derived benchmark; CLR-derived FMR fallback handled upstream. */
  fair_market_value?: number | null | undefined;
  grantors?: string | null | undefined;
  grantees?: string | null | undefined;
  grantor?: string | null | undefined;
  grantee?: string | null | undefined;
}

/** The derived flag bundle written onto `public.transfer` (subset of TransferRow). */
export interface TransferFlags {
  is_sheriff: boolean;
  is_distress_doc: boolean;
  is_estate_or_nonmarket: boolean;
  is_arms_length: boolean;
  price_to_assessment: number | null;
}

/** Normalize a document_type for vocab comparison (trim + upper). */
function normDoc(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/** Concatenated grantor + grantee free-text, upper-cased, for name matching. */
function partyText(row: TransferInput): string {
  const parts = [row.grantors, row.grantees, row.grantor, row.grantee]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' | ');
  return parts.toUpperCase();
}

/**
 * Extract candidate surnames from a free-text party string. RTT names are
 * typically "LAST FIRST" or "LAST FIRST MIDDLE" with multiple parties separated
 * by delimiters. We take the FIRST token of each delimited party as its surname
 * — good enough for the intra-family proxy heuristic, which only fires together
 * with nominal consideration (so a false positive still requires a sub-$1k deed).
 */
function surnames(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const party of raw.toUpperCase().split(/[,;/&|]| AND /)) {
    const first = party.trim().split(/\s+/)[0];
    if (first && first.length >= 2 && /^[A-Z]/.test(first)) out.add(first);
  }
  return out;
}

/**
 * True when grantor and grantee share a surname (intra-family proxy). Used only
 * in combination with nominal consideration (PRD §5.1).
 */
function sharesSurname(row: TransferInput): boolean {
  const fromNames = surnames(row.grantors ?? row.grantor);
  const toNames = surnames(row.grantees ?? row.grantee);
  if (fromNames.size === 0 || toNames.size === 0) return false;
  for (const s of fromNames) {
    if (toNames.has(s)) return true;
  }
  return false;
}

/**
 * Derive the transfer flags for a single row.
 *
 * - `is_sheriff`      = document_type ∈ adapter.documentTypes.sheriff
 * - `is_distress_doc` = document_type ∈ adapter.documentTypes.distress
 * - `is_estate_or_nonmarket` = grantor/grantee names match estateNameRegex,
 *      OR same-surname intra-family transfer with nominal consideration.
 * - `is_arms_length`  = document_type ∈ armsLength AND
 *      total_consideration > nominalConsiderationFloor AND
 *      NOT is_distress_doc AND NOT is_estate_or_nonmarket.
 * - `price_to_assessment` = total_consideration / fair_market_value
 *      (null when fmv is null/0 or consideration is null) — assessment-relative
 *      DIAGNOSTIC, not the market benchmark.
 */
export function deriveTransferFlags(
  row: TransferInput,
  adapter: Pick<CityAdapter, 'documentTypes' | 'nominalConsiderationFloor'>,
): TransferFlags {
  const doc = normDoc(row.document_type);
  const { sheriff, distress, armsLength, estateNameRegex } = adapter.documentTypes;

  const is_sheriff = sheriff.map(normDoc).includes(doc);
  const is_distress_doc = distress.map(normDoc).includes(doc);

  const consideration =
    typeof row.total_consideration === 'number' && Number.isFinite(row.total_consideration)
      ? row.total_consideration
      : null;
  const isNominal = consideration !== null && consideration <= adapter.nominalConsiderationFloor;

  const nameIsEstate = estateNameRegex.test(partyText(row));
  const intraFamilyNominal = isNominal && sharesSurname(row);
  const is_estate_or_nonmarket = nameIsEstate || intraFamilyNominal;

  const is_arms_length =
    armsLength.map(normDoc).includes(doc) &&
    consideration !== null &&
    consideration > adapter.nominalConsiderationFloor &&
    !is_distress_doc &&
    !is_estate_or_nonmarket;

  const fmv =
    typeof row.fair_market_value === 'number' && Number.isFinite(row.fair_market_value)
      ? row.fair_market_value
      : null;
  const price_to_assessment =
    consideration !== null && fmv !== null && fmv !== 0 ? consideration / fmv : null;

  return {
    is_sheriff,
    is_distress_doc,
    is_estate_or_nonmarket,
    is_arms_length,
    price_to_assessment,
  };
}
