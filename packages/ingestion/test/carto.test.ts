/**
 * Carto adapter tests (PRD §4.1, §4.2): keyset SQL shape, paginated iteration via
 * an injected fake fetch (default suite is offline), and an OPT-IN live smoke
 * test guarded by CARTO_LIVE=1 (Carto is public so this is safe, but it must
 * never run by default / in CI without the flag).
 */
import { describe, it, expect, vi } from 'vitest';
import { philadelphia } from '@bandbox/core';
import {
  buildCartoUrl,
  buildKeysetSql,
  fetchCartoPage,
  iterateCartoPages,
  type FetchLike,
} from '../src/adapters/carto.js';

describe('buildKeysetSql — keyset on cartodb_id, never OFFSET', () => {
  it('emits WHERE cartodb_id > cursor ORDER BY cartodb_id LIMIT page', () => {
    const sql = buildKeysetSql({
      endpoint: 'https://phl.carto.com/api/v2/sql',
      table: 'rtt_summary',
      cursor: 1000,
      pageSize: 500,
    });
    expect(sql).toContain('FROM rtt_summary');
    expect(sql).toContain('cartodb_id > 1000');
    expect(sql).toContain('ORDER BY cartodb_id ASC');
    expect(sql).toContain('LIMIT 500');
    expect(sql).not.toContain('OFFSET');
  });

  it('omits the cursor predicate on the first page (cursor null)', () => {
    const sql = buildKeysetSql({
      endpoint: 'https://phl.carto.com/api/v2/sql',
      table: 'permits',
      cursor: null,
      pageSize: 10,
    });
    expect(sql).not.toContain('cartodb_id >');
    expect(sql).toContain('ORDER BY cartodb_id ASC LIMIT 10');
  });

  it('materializes geometry by mode (geojson / wkt), never lat/lng columns', () => {
    const geo = buildKeysetSql({ endpoint: 'https://phl.carto.com/api/v2/sql', table: 't', pageSize: 1, geometryMode: 'geojson' });
    expect(geo).toContain('ST_AsGeoJSON(the_geom) AS geom_geojson');
    const wkt = buildKeysetSql({ endpoint: 'https://phl.carto.com/api/v2/sql', table: 't', pageSize: 1, geometryMode: 'wkt' });
    expect(wkt).toContain('ST_AsText(the_geom) AS geom_wkt');
    const none = buildKeysetSql({ endpoint: 'https://phl.carto.com/api/v2/sql', table: 't', pageSize: 1, geometryMode: 'none' });
    expect(none).not.toContain('the_geom');
    for (const s of [geo, wkt, none]) {
      expect(s.toLowerCase()).not.toContain('latitude');
      expect(s.toLowerCase()).not.toContain('longitude');
    }
  });

  it('appends an extra WHERE predicate (windowing / noise filter) with AND', () => {
    const sql = buildKeysetSql({
      endpoint: 'https://phl.carto.com/api/v2/sql',
      table: 'public_cases_fc',
      cursor: 5,
      pageSize: 100,
      where: "subject <> 'Information Request'",
    });
    expect(sql).toContain('cartodb_id > 5');
    expect(sql).toContain("AND (subject <> 'Information Request')");
  });
});

describe('buildCartoUrl', () => {
  it('encodes q= and format=json', () => {
    const url = buildCartoUrl('https://phl.carto.com/api/v2/sql', 'SELECT 1');
    expect(url).toContain('q=SELECT+1');
    expect(url).toContain('format=json');
  });
});

/** Build a fake fetch that returns a JSON Carto envelope of given rows. */
function fakeFetch(pages: Record<string, unknown>[][]): FetchLike {
  let call = 0;
  return vi.fn(async () => {
    const rows = pages[Math.min(call, pages.length - 1)] ?? [];
    call += 1;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ rows }),
    };
  });
}

describe('fetchCartoPage + iterateCartoPages (offline, injected fetch)', () => {
  it('parses the envelope and advances nextCursor to the page max', async () => {
    const page = await fetchCartoPage({
      endpoint: 'https://phl.carto.com/api/v2/sql',
      table: 'rtt_summary',
      pageSize: 3,
      fetchImpl: fakeFetch([
        [
          { cartodb_id: 10, a: 1 },
          { cartodb_id: 11, a: 2 },
          { cartodb_id: 12, a: 3 },
        ],
      ]),
    });
    expect(page.rows.length).toBe(3);
    expect(page.nextCursor).toBe(12);
    expect(page.hasMore).toBe(true); // full page
  });

  it('iterates pages until a short page signals the end', async () => {
    const fetchImpl = fakeFetch([
      [
        { cartodb_id: 1 },
        { cartodb_id: 2 },
      ],
      [{ cartodb_id: 3 }], // short page → stop after yielding
    ]);
    const seen: number[] = [];
    for await (const p of iterateCartoPages({ endpoint: 'https://phl.carto.com/api/v2/sql', table: 't', pageSize: 2, fetchImpl })) {
      for (const r of p.rows) seen.push((r as { cartodb_id: number }).cartodb_id);
    }
    expect(seen).toEqual([1, 2, 3]);
  });

  it('throws on a non-2xx response (caller decides; does not halt other sources)', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => '',
    });
    await expect(
      fetchCartoPage({ endpoint: 'https://phl.carto.com/api/v2/sql', table: 'permits', pageSize: 1, fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('throws on a malformed (non-rows) envelope', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ nope: true }),
    });
    await expect(
      fetchCartoPage({ endpoint: 'https://phl.carto.com/api/v2/sql', table: 'permits', pageSize: 1, fetchImpl }),
    ).rejects.toThrow(/missing rows/);
  });
});

// ── OPT-IN live smoke test. Default suite NEVER hits the network. ──────────────
const live = process.env['CARTO_LIVE'] === '1';
describe.runIf(live)('Carto LIVE smoke (CARTO_LIVE=1)', () => {
  it('fetches one real keyset page from rtt_summary', async () => {
    const rtt = philadelphia.sources.find((s) => s.name === 'rtt_summary')!;
    const page = await fetchCartoPage({
      endpoint: rtt.endpoint,
      table: rtt.name,
      pageSize: 2,
      cursor: 0,
    });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.nextCursor).not.toBeNull();
  }, 35_000);
});
