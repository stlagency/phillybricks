/**
 * Fetcher tests (PRD §4.1, §4.2): OPA freshness/row-count gating + clean-skip on a
 * not-newer object; Carto keyset windowing, cursor resume, and geom-valid counting.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '@bandbox/core';
import type { SourceSpec } from '@bandbox/core/contracts';
import { Readable } from 'node:stream';
import { makeCartoFetcher, makeOpaFetcher } from '../src/fetchers.js';
import type { FetchLike } from '../src/adapters/carto.js';
import type { OpaHttp } from '../src/adapters/opaBulk.js';
import { OPA_EXPECTED_ROWS } from '../src/adapters/opaBulk.js';
import { FakeDb } from './helpers.js';

const spec = (name: string): SourceSpec => philadelphia.sources.find((x) => x.name === name)!;

/** Build a CSV stream with `n` data rows (header + minimal columns). */
function csvStream(n: number): Readable {
  const header = 'parcel_number,shape\n';
  let body = '';
  for (let i = 0; i < n; i++) body += `${100000000 + i},SRID=2272;POINT(1 2)\n`;
  return Readable.from([header + body]);
}

describe('makeOpaFetcher', () => {
  it('returns an EMPTY batch when the S3 object is not newer (clean skip — no retire trigger)', async () => {
    const db = new FakeDb().on('from ops.source_cursor', () => [
      { source: 'opa_properties_public', last_cartodb_id: null, watermark: '2026-06-18T00:00:00.000Z', rows_committed: 1 },
    ]);
    const http: OpaHttp = {
      async head() {
        return { lastModifiedMs: Date.parse('2026-06-17T00:00:00.000Z') }; // older than watermark
      },
      async getStream() {
        throw new Error('getStream must NOT be called on a not-newer object');
      },
    };
    const batch = await makeOpaFetcher({ http })(spec('opa_properties_public'), db.client);
    expect(batch.rows).toEqual([]);
    expect(batch.watermark).toBe('2026-06-17T00:00:00.000Z');
  });

  it('streams + accepts an in-band row count', async () => {
    const db = new FakeDb(); // no cursor → first run
    const http: OpaHttp = {
      async head() {
        return { lastModifiedMs: Date.parse('2026-06-18T00:00:00.000Z') };
      },
      async getStream() {
        return csvStream(OPA_EXPECTED_ROWS); // exactly expected ⇒ in band
      },
    };
    const batch = await makeOpaFetcher({ http })(spec('opa_properties_public'), db.client);
    expect(batch.rows.length).toBe(OPA_EXPECTED_ROWS);
  });

  it('THROWS on an out-of-band (truncated) download — never promotes bad data', async () => {
    const db = new FakeDb();
    const http: OpaHttp = {
      async head() {
        return { lastModifiedMs: Date.parse('2026-06-18T00:00:00.000Z') };
      },
      async getStream() {
        return csvStream(100); // far below the ±5% band
      },
    };
    await expect(makeOpaFetcher({ http })(spec('opa_properties_public'), db.client)).rejects.toThrow(
      /outside band/,
    );
  });
});

describe('makeCartoFetcher', () => {
  /** A fake Carto SQL API returning one page then an empty page. */
  function cartoFetch(pages: Record<string, unknown>[][]): { impl: FetchLike; urls: string[] } {
    const urls: string[] = [];
    let call = 0;
    const impl: FetchLike = async (url) => {
      urls.push(url);
      const rows = pages[call] ?? [];
      call += 1;
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ rows }) };
    };
    return { impl, urls };
  }

  it('resumes from the stored cursor, applies the window predicate, returns nextCursor + geom count', async () => {
    const db = new FakeDb().on('from ops.source_cursor', () => [
      { source: 'incidents_part1_part2', last_cartodb_id: 500, watermark: null, rows_committed: 500 },
    ]);
    const { impl, urls } = cartoFetch([
      [
        { cartodb_id: 501, dc_key: '1', geom_geojson: '{"type":"Point","coordinates":[-75,40]}' },
        { cartodb_id: 502, dc_key: '2', geom_geojson: '' }, // missing geom
      ],
      [], // drained
    ]);
    const batch = await makeCartoFetcher({ fetchImpl: impl, maxPages: 5 })(
      spec('incidents_part1_part2'),
      db.client,
    );
    expect(batch.rows.length).toBe(2);
    expect(batch.nextCursor).toBe(502);
    expect(batch.geomValidCount).toBe(1); // only one row has a usable geometry
    // window predicate + keyset cursor are in the issued SQL. (URLSearchParams
    // encodes spaces as '+', which decodeURIComponent leaves intact — convert them.)
    const decoded = decodeURIComponent(urls[0]!.replace(/\+/g, ' '));
    expect(decoded).toContain('cartodb_id > 500');
    expect(decoded).toContain("dispatch_date_time >= (now() - interval '10 years')");
    expect(decoded).toContain('ST_AsGeoJSON(the_geom)');
  });

  it('non-spatial source: no geomValidCount', async () => {
    const db = new FakeDb();
    const { impl } = cartoFetch([[{ cartodb_id: 1, permitnumber: 'MP-1', opa_account_num: '212440300' }], []]);
    const batch = await makeCartoFetcher({ fetchImpl: impl, maxPages: 5 })(spec('permits'), db.client);
    expect(batch.geomValidCount).toBeUndefined();
    expect(batch.nextCursor).toBe(1);
  });
});
