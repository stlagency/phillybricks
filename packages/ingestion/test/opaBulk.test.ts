/**
 * OPA bulk-CSV adapter tests (PRD §3.1, §4.2): freshness gate (Last-Modified +
 * row count), WKT/EWKT geom SQL, soft-retire, and a golden CSV parse that proves
 * the parcel_id_num decoy does NOT yield a valid OPA join.
 */
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { philadelphia } from '@bandbox/core';
import {
  OPA_EXPECTED_ROWS,
  computeSoftRetire,
  evaluateOpaFreshness,
  evaluateOpaRowCount,
  geomSqlExpr,
  parseOpaCsv,
} from '../src/adapters/opaBulk.js';
import { measureJoinRate } from '../src/joinRate.js';
import { readFixture, loadParcelIndexFixture } from './helpers.js';

describe('OPA freshness gate — Last-Modified', () => {
  it('first run is fresh', () => {
    expect(
      evaluateOpaFreshness({ head: { lastModifiedMs: 1000 }, lastRunLastModifiedMs: null }),
    ).toEqual({ fresh: true, reason: 'first_run' });
  });

  it('newer object is fresh; not-newer is stale (skip + alert, no halt)', () => {
    expect(
      evaluateOpaFreshness({ head: { lastModifiedMs: 2000 }, lastRunLastModifiedMs: 1000 }).fresh,
    ).toBe(true);
    expect(
      evaluateOpaFreshness({ head: { lastModifiedMs: 1000 }, lastRunLastModifiedMs: 1000 }),
    ).toEqual({ fresh: false, reason: 'not_newer' });
  });

  it('unknown Last-Modified is treated as not-fresh (no phantom load)', () => {
    expect(
      evaluateOpaFreshness({ head: { lastModifiedMs: null }, lastRunLastModifiedMs: 1000 }),
    ).toEqual({ fresh: false, reason: 'unknown_last_modified' });
  });
});

describe('OPA freshness gate — row count within ±5% of ~583,617', () => {
  it('exact expected count passes', () => {
    expect(evaluateOpaRowCount(OPA_EXPECTED_ROWS).ok).toBe(true);
  });
  it('±5% boundary passes, outside fails', () => {
    expect(evaluateOpaRowCount(Math.floor(OPA_EXPECTED_ROWS * 0.96)).ok).toBe(true);
    expect(evaluateOpaRowCount(Math.floor(OPA_EXPECTED_ROWS * 0.9)).ok).toBe(false);
    expect(evaluateOpaRowCount(Math.ceil(OPA_EXPECTED_ROWS * 1.1)).ok).toBe(false);
  });
});

describe('geom SQL — WKT vs EWKT, no lat/lng', () => {
  it('EWKT (SRID= prefix) → ST_GeomFromEWKT', () => {
    const r = geomSqlExpr('SRID=4326;POINT(-75.16 39.95)');
    expect(r.expr).toBe('ST_GeomFromEWKT(:geom)');
    expect(r.value).toContain('SRID=4326');
  });
  it('plain WKT → ST_GeomFromText with explicit 4326', () => {
    const r = geomSqlExpr('POINT(-75.16 39.95)');
    expect(r.expr).toBe('ST_SetSRID(ST_GeomFromText(:geom), 4326)');
    expect(r.value).toBe('POINT(-75.16 39.95)');
  });
  it('empty geometry → NULL::geometry, never an error', () => {
    expect(geomSqlExpr('').expr).toBe('NULL::geometry');
    expect(geomSqlExpr(null).expr).toBe('NULL::geometry');
    expect(geomSqlExpr('   ').value).toBeNull();
  });
});

describe('soft-retire — never hard-delete', () => {
  it('retires canonical-active keys absent from the fresh load', () => {
    const canonicalActive = ['111111111', '222222222', '333333333'];
    const loaded = new Set(['111111111', '333333333']);
    expect(computeSoftRetire(canonicalActive, loaded)).toEqual(['222222222']);
  });
  it('retires nothing when the load is a superset', () => {
    expect(computeSoftRetire(['111111111'], new Set(['111111111', '999999999']))).toEqual([]);
  });
});

describe('golden OPA CSV parse', () => {
  it('stream-parses the header into object rows', async () => {
    const csv = readFixture('opa_golden.csv');
    const { rows, rowCount } = await parseOpaCsv(Readable.from([csv]));
    expect(rowCount).toBe(10);
    expect(rows[0]).toMatchObject({ parcel_number: '523045600', address: '123 MARKET ST' });
    // the_geom is carried as raw WKT/EWKT text for ST_GeomFrom* at load.
    expect(rows[0]!['the_geom']).toContain('POINT');
  });

  it('the parcel_id_num decoy column NEVER yields a valid OPA join', async () => {
    const csv = readFixture('opa_golden.csv');
    const { rows } = await parseOpaCsv(Readable.from([csv]));
    const parcelIndex = loadParcelIndexFixture();

    // Join on the documented key (parcel_number): 9 of 10 join.
    const onParcelNumber = measureJoinRate('opa', rows, ['parcel_number'], philadelphia, parcelIndex);
    expect(onParcelNumber.bestRate).toBeCloseTo(0.9, 5);

    // Join on the DECOY (parcel_id_num): every value is 10 digits → all rejected
    // by norm_parcel (>9) → ZERO joins. The decoy cannot masquerade as an OPA id.
    const onDecoy = measureJoinRate('opa', rows, ['parcel_id_num'], philadelphia, parcelIndex);
    expect(onDecoy.perKey[0]!.normalizedCount).toBe(0);
    expect(onDecoy.bestRate).toBe(0);
  });
});
