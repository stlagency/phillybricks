/**
 * OPA category_code → comps BroadCategory (PRD §5.2). The OPA category codes are a
 * Philly source vocabulary; this small map mirrors their documented meaning so the
 * comp same-category filter is correct. (Not a forbidden source literal — these are
 * single-char category codes, not table/column/endpoint names.)
 *   1 single-family · 2 multi-family · 3 mixed (store+dwelling) · 4 commercial
 *   5 industrial · 6 vacant land · others → other.
 */
import type { BroadCategory } from '@bandbox/core';

export function broadCategory(code: string | null): BroadCategory {
  switch ((code ?? '').trim()) {
    case '1':
    case '2':
      return 'residential';
    case '3':
      return 'mixed';
    case '4':
      return 'commercial';
    case '6':
      return 'land';
    default:
      return 'other';
  }
}
