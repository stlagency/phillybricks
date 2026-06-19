/**
 * Parcel-key normalization for the ingestion worker (PRD §3.1).
 *
 * This module is a THIN delegating wrapper. The canonical rule lives in exactly
 * two places that must agree byte-for-byte:
 *   1. the SQL `norm_parcel(text)` function (packages/db migration 0002), and
 *   2. `philadelphia.normParcelKey` in @bandbox/core.
 * To guarantee parity we DO NOT re-implement the rule here — we delegate to the
 * adapter. (A duplicated regex would be a place for the two to silently drift;
 * the golden tests assert the delegation, not a fork.)
 *
 * The rule, for reference (enforced upstream, asserted in core's fixtures):
 *   strip non-digits → x; length 9 → as-is; 1–8 → lpad to 9; >9/empty → null.
 * A >9-digit input is rejected precisely so the L&I decoy id column (the one
 * that is NOT an OPA account) can never be coerced into a colliding 9-digit key.
 * Which raw columns are safe to feed in is the adapter's `keyColumns` decision.
 */
import type { CityAdapter } from '@bandbox/core/contracts';

/** Why a raw key failed to become a usable `parcel_pk`. */
export type QuarantineReason = 'malformed_key' | 'unjoined';

/** A single rejected/unjoinable raw key, destined for `ops.parcel_key_quarantine`. */
export interface QuarantineRow {
  raw_key: string;
  source: string;
  reason: QuarantineReason;
}

/**
 * Normalize a single candidate raw key by delegating to the city adapter, which
 * is the one true mirror of the SQL `norm_parcel`. Returns the 9-digit key or
 * null (caller quarantines + counts on null — never silent-pad).
 */
export function normParcel(raw: string | null | undefined, adapter: CityAdapter): string | null {
  return adapter.normParcelKey(raw);
}

/**
 * Normalize a row across its candidate key columns IN PRIORITY ORDER, returning
 * the first column that yields a non-null 9-digit key. The join-rate gate decides
 * whether the *normalized* key actually joins to `public.parcel`; this only does
 * the structural normalization step.
 *
 * Returns the chosen `{ key, column }`, or null with the reason `malformed_key`
 * when EVERY candidate column normalizes to null (so the caller quarantines the
 * row and increments `malformed_key_count`).
 */
export function normParcelFromRow(
  row: Record<string, unknown>,
  keyColumns: readonly string[],
  adapter: CityAdapter,
): { key: string; column: string } | null {
  for (const column of keyColumns) {
    const raw = row[column];
    const normalized = adapter.normParcelKey(raw == null ? null : String(raw));
    if (normalized !== null) return { key: normalized, column };
  }
  return null;
}

/**
 * Build a quarantine row for a raw key the normalizer (or a candidate join)
 * rejected. The persistence (insert into `ops.parcel_key_quarantine` + bump
 * `ops.ingest_run.malformed_key_count`) is done by the caller that owns the run.
 */
export function makeQuarantineRow(
  rawKey: string | null | undefined,
  source: string,
  reason: QuarantineReason,
): QuarantineRow {
  return { raw_key: rawKey ?? '', source, reason };
}

/**
 * Persist a batch of quarantined keys + the malformed count for a run. Pure-SQL
 * helper so both the OPA and Carto paths share one implementation. Inserts each
 * quarantine row tied to `ingestRunId`, then increments
 * `ops.ingest_run.malformed_key_count` by the number of `malformed_key` rows
 * (NOT `unjoined` rows — those are gate misses, counted separately).
 *
 * NEVER halts. A quarantine is an audit record, not a failure.
 */
export async function persistQuarantine(
  db: {
    unsafe<T extends readonly unknown[] = readonly unknown[]>(q: string, p?: unknown[]): Promise<T>;
  },
  rows: readonly QuarantineRow[],
  ingestRunId: number | null,
): Promise<void> {
  if (rows.length === 0) return;
  // Bulk insert via a single multi-row VALUES list. Schema-qualified relation is
  // a constant (ops.parcel_key_quarantine); values are bound parameters.
  const valuesSql: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const r of rows) {
    valuesSql.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(r.raw_key, r.source, r.reason, ingestRunId);
  }
  await db.unsafe(
    `insert into ops.parcel_key_quarantine (raw_key, source, reason, ingest_run_id)
     values ${valuesSql.join(', ')}`,
    params,
  );

  const malformed = rows.filter((r) => r.reason === 'malformed_key').length;
  if (malformed > 0 && ingestRunId !== null) {
    await db.unsafe(
      `update ops.ingest_run
         set malformed_key_count = malformed_key_count + $1
       where id = $2`,
      [malformed, ingestRunId],
    );
  }
}
