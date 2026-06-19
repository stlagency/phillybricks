/**
 * normParcel parity + quarantine helper tests (PRD §3.1).
 *
 * The ingestion normalizer DELEGATES to the adapter (the one mirror of SQL
 * norm_parcel), so parity is guaranteed by construction. These fixtures assert
 * the delegation and the candidate-column selection + quarantine plumbing.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '@bandbox/core';
import {
  makeQuarantineRow,
  normParcel,
  normParcelFromRow,
  persistQuarantine,
} from '../src/normParcel.js';
import { FakeDb } from './helpers.js';

describe('normParcel — delegates to the adapter (SQL norm_parcel parity)', () => {
  it.each([
    ['12345', '000012345'],
    ['523045600', '523045600'],
    ['52-3-456', '000523456'],
    ['1234567890', null], // 10-digit decoy → reject
    ['', null],
    [null, null],
    ['ABC', null],
  ])('normParcel(%j) === adapter.normParcelKey(%j) === %j', (input, expected) => {
    expect(normParcel(input as string | null, philadelphia)).toBe(expected);
    // It MUST be the very same function result (no fork).
    expect(normParcel(input as string | null, philadelphia)).toBe(
      philadelphia.normParcelKey(input as string | null),
    );
  });
});

describe('normParcelFromRow — first non-null candidate in priority order', () => {
  it('takes the first candidate column that normalizes', () => {
    const row = { opa_account_num: '1234567890', parcel_number: '523045600' };
    const hit = normParcelFromRow(row, ['opa_account_num', 'parcel_number'], philadelphia);
    // opa_account_num is a 10-digit decoy → null; falls through to parcel_number.
    expect(hit).toEqual({ key: '523045600', column: 'parcel_number' });
  });

  it('returns null when every candidate column rejects (→ malformed quarantine)', () => {
    const row = { opa_account_num: 'XYZ', parcel_number: '99999999999' };
    expect(normParcelFromRow(row, ['opa_account_num', 'parcel_number'], philadelphia)).toBeNull();
  });

  it('returns null for an empty candidate list (spatial sources)', () => {
    expect(normParcelFromRow({ a: 1 }, [], philadelphia)).toBeNull();
  });
});

describe('persistQuarantine — inserts rows + bumps malformed_key_count', () => {
  it('inserts every quarantine row and increments the count for malformed rows only', async () => {
    const db = new FakeDb();
    await persistQuarantine(
      db.client,
      [
        makeQuarantineRow('XYZ', 'permits', 'malformed_key'),
        makeQuarantineRow('523045600', 'permits', 'unjoined'),
      ],
      99,
    );
    // One bulk insert.
    expect(db.indicesOf('insert into ops.parcel_key_quarantine').length).toBe(1);
    // Count bump runs (1 malformed row of the 2).
    expect(db.indicesOf('malformed_key_count = malformed_key_count').length).toBe(1);
  });

  it('is a no-op for an empty batch', async () => {
    const db = new FakeDb();
    await persistQuarantine(db.client, [], 1);
    expect(db.calls.length).toBe(0);
  });

  it('skips the count bump when there are only unjoined rows', async () => {
    const db = new FakeDb();
    await persistQuarantine(db.client, [makeQuarantineRow('523045600', 'rtt_summary', 'unjoined')], 5);
    expect(db.indicesOf('insert into ops.parcel_key_quarantine').length).toBe(1);
    expect(db.indicesOf('malformed_key_count = malformed_key_count').length).toBe(0);
  });
});
