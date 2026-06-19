/**
 * Resumable backfill tests (PRD M1a): cursor commits every N pages, drains to the
 * end, resumes from a stored cursor, and stops + persists on the time budget.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '@bandbox/core';
import type { SourceSpec } from '@bandbox/core/contracts';
import { backfillSource } from '../src/backfill.js';
import type { FetchLike } from '../src/adapters/carto.js';
import { FakeDb } from './helpers.js';

const rtt = (): SourceSpec => philadelphia.sources.find((s) => s.name === 'rtt_summary')!;

/** A fake Carto API yielding `pages` of rows keyed by ascending cartodb_id. */
function cartoPages(pages: Record<string, unknown>[][]): FetchLike {
  return async (url) => {
    // extract the cursor from "cartodb_id > N" to decide which page to serve
    const m = /cartodb_id\s*>\s*(\d+)/.exec(decodeURIComponent(url.replace(/\+/g, ' ')));
    const after = m ? Number(m[1]) : -1;
    const next = pages.find((p) => p.length > 0 && Number(p[0]!.cartodb_id) > after) ?? [];
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ rows: next }) };
  };
}

function rttRows(ids: number[]): Record<string, unknown>[] {
  return ids.map((id) => ({
    cartodb_id: id,
    objectid: id,
    opa_account_num: '481352600',
    document_type: 'DEED',
    total_consideration: 300000,
    recording_date: '2020-01-01',
  }));
}

describe('backfillSource', () => {
  it('streams every page, upserts, commits the cursor, and reports drained', async () => {
    const db = new FakeDb(); // no stored cursor → start from beginning
    const fetchImpl = cartoPages([rttRows([1, 2]), rttRows([3, 4]), rttRows([5])]);
    const res = await backfillSource(db.client, rtt(), {
      fetchImpl,
      pageSize: 2,
      commitEveryPages: 1,
      maxRuntimeMs: 60_000,
      now: () => 0, // never exceeds the budget
    });
    expect(res.drained).toBe(true);
    expect(res.stoppedForTime).toBe(false);
    expect(res.rowsPromoted).toBe(5);
    expect(res.lastCursor).toBe(5);
    // upserts into public.transfer happened
    expect(db.indicesOf('insert into public.transfer').length).toBeGreaterThanOrEqual(3);
    // cursor was committed (insert into ops.source_cursor)
    expect(db.indicesOf('insert into ops.source_cursor').length).toBeGreaterThanOrEqual(3);
  });

  it('resumes from a stored cursor (does not re-fetch committed pages)', async () => {
    const db = new FakeDb().on('from ops.source_cursor', () => [
      { source: 'rtt_summary', last_cartodb_id: 2, watermark: null, rows_committed: 2 },
    ]);
    const fetchImpl = cartoPages([rttRows([1, 2]), rttRows([3, 4]), rttRows([5])]);
    const res = await backfillSource(db.client, rtt(), {
      fetchImpl,
      pageSize: 2,
      commitEveryPages: 5,
      now: () => 0,
    });
    // started after cursor 2 → only ids 3,4,5 promoted
    expect(res.rowsPromoted).toBe(3);
    expect(res.lastCursor).toBe(5);
  });

  it('stops + persists when the runtime budget is exceeded (resumable)', async () => {
    const db = new FakeDb();
    const fetchImpl = cartoPages([rttRows([1, 2]), rttRows([3, 4]), rttRows([5, 6])]);
    let t = 0;
    const res = await backfillSource(db.client, rtt(), {
      fetchImpl,
      pageSize: 2,
      commitEveryPages: 1,
      maxRuntimeMs: 100,
      now: () => (t += 80), // exceeds 100 after the 2nd page
    });
    expect(res.stoppedForTime).toBe(true);
    expect(res.drained).toBe(false);
    // a final cursor persist always happens so the next run resumes cleanly
    expect(db.indicesOf('insert into ops.source_cursor').length).toBeGreaterThanOrEqual(1);
  });
});
