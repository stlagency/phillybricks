/**
 * GOLDEN per-source JOIN-RATE gate tests (PRD §3.1, §4.3) — one of the four
 * correctness gates.
 *
 * Asserts, against fixtures with KNOWN expected join rates:
 *   - a below-threshold batch is QUARANTINED (gate ≠ halt; never throws);
 *   - an at-threshold batch PASSES;
 *   - the OPA `parcel_id_num` decoy value does NOT yield a valid OPA join;
 *   - spatial sources (expectedJoinRate undefined) skip the parcel gate.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '@bandbox/core';
import type { SourceSpec } from '@bandbox/core/contracts';
import { evaluateGate, measureJoinRate } from '../src/joinRate.js';
import { loadJsonFixture, loadParcelIndexFixture } from './helpers.js';

const parcelIndex = loadParcelIndexFixture();

function spec(name: string): SourceSpec {
  const s = philadelphia.sources.find((x) => x.name === name);
  if (!s) throw new Error(`no source ${name}`);
  return s;
}

describe('measureJoinRate — per-key empirical rates', () => {
  it('measures OPA parcel_number at the known golden rate and rejects the decoy', () => {
    type Row = Record<string, unknown>;
    // Reuse the RTT-shaped numeric values via the OPA-style golden batch: build
    // it from the parcel index so the rate is exact and self-documenting.
    const rows: Row[] = [
      { parcel_number: '523045600', pin: '1001523045600', parcel_id_num: '5230456001' },
      { parcel_number: '351243300', pin: '1001351243300', parcel_id_num: '3512433001' },
      { parcel_number: '881000000', pin: '1001881000000', parcel_id_num: '8810000001' },
      { parcel_number: '000012345', pin: '1001000012345', parcel_id_num: '0000123451' },
      { parcel_number: '012345678', pin: '1001012345678', parcel_id_num: '0123456781' },
      { parcel_number: '100200300', pin: '1001100200300', parcel_id_num: '1002003001' },
      { parcel_number: '200300400', pin: '1001200300400', parcel_id_num: '2003004001' },
      { parcel_number: '300400500', pin: '1001300400500', parcel_id_num: '3004005001' },
      { parcel_number: '400500600', pin: '1001400500600', parcel_id_num: '4005006001' },
      { parcel_number: '999888777', pin: '1001999888777', parcel_id_num: '9998887771' }, // not in index
    ];
    const opaSpec = spec('opa_properties_public');
    const m = measureJoinRate(opaSpec.name, rows, opaSpec.keyColumns, philadelphia, parcelIndex);

    const parcelNumber = m.perKey.find((k) => k.column === 'parcel_number')!;
    // 9 of 10 parcel_number values are in the index.
    expect(parcelNumber.rate).toBeCloseTo(0.9, 5);
    expect(m.bestColumn).toBe('parcel_number');
    expect(m.bestRate).toBeCloseTo(0.9, 5);

    // pin here is 13-digit → normParcel rejects (>9) → never joins.
    const pin = m.perKey.find((k) => k.column === 'pin')!;
    expect(pin.normalizedCount).toBe(0);
    expect(pin.rate).toBe(0);
  });

  it('the parcel_id_num decoy (10-digit) does NOT yield a valid OPA join', () => {
    // A batch whose ONLY candidate key is the L&I parcel_id_num decoy. Every
    // value is 10 digits → norm_parcel rejects (>9) → zero joins, no collision.
    const rows = [
      { parcel_id_num: '5230456001' }, // decoy shape of a real OPA id
      { parcel_id_num: '3512433001' },
      { parcel_id_num: '8810000001' },
    ];
    const m = measureJoinRate('decoy_probe', rows, ['parcel_id_num'], philadelphia, parcelIndex);
    const k = m.perKey[0]!;
    expect(k.normalizedCount).toBe(0); // all rejected as >9 digits
    expect(k.joinedCount).toBe(0);
    expect(m.bestRate).toBe(0);
  });
});

describe('evaluateGate — quarantine vs pass (gate ≠ halt)', () => {
  it('QUARANTINES a below-threshold RTT batch without throwing', () => {
    const rtt = loadJsonFixture<{ rows: Record<string, unknown>[] }>('rtt_below_threshold.json');
    const rttSpec = spec('rtt_summary');
    // MEASURED baseline (2026-06-18): RTT floors low (historic deeds join low).
    expect(rttSpec.expectedJoinRate).toBe(0.45);

    const m = measureJoinRate(rttSpec.name, rtt.rows, rttSpec.keyColumns, philadelphia, parcelIndex);
    // Only 3 of 10 opa_account_num values are in the index → 0.30 (still below 0.45).
    expect(m.bestRate).toBeCloseTo(0.3, 5);

    // The gate decides — it must NOT throw, and the decision is quarantine.
    let decision!: ReturnType<typeof evaluateGate>;
    expect(() => {
      decision = evaluateGate(rttSpec, m);
    }).not.toThrow();
    expect(decision.kind).toBe('quarantine');
    if (decision.kind === 'quarantine') {
      expect(decision.threshold).toBe(0.45);
      expect(decision.bestRate).toBeCloseTo(0.3, 5);
    }
  });

  it('PASSES an at-threshold batch (best rate >= threshold)', () => {
    // permits MEASURED baseline 0.85; a 0.98 batch (49/50) is comfortably above it.
    const permitsSpec = spec('permits');
    expect(permitsSpec.expectedJoinRate).toBe(0.85);
    const joinKeys = [
      '523045600',
      '351243300',
      '881000000',
      '000012345',
      '012345678',
      '100200300',
      '200300400',
      '300400500',
      '400500600',
      '500600700',
    ];
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 49; i++) {
      rows.push({ opa_account_num: joinKeys[i % joinKeys.length]!, parcel_number: null });
    }
    // One row that does not join (a real account no longer in OPA).
    rows.push({ opa_account_num: '909090909', parcel_number: null });

    const m = measureJoinRate(permitsSpec.name, rows, permitsSpec.keyColumns, philadelphia, parcelIndex);
    expect(m.bestRate).toBeCloseTo(0.98, 5);
    const decision = evaluateGate(permitsSpec, m);
    expect(decision.kind).toBe('pass');
  });

  it('boundary: rate exactly equal to threshold PASSES (>=, not >)', () => {
    const s: Pick<SourceSpec, 'expectedJoinRate'> = { expectedJoinRate: 0.5 };
    const m = measureJoinRate(
      'boundary',
      [{ k: '523045600' }, { k: '909090909' }], // 1 of 2 joins → 0.5
      ['k'],
      philadelphia,
      parcelIndex,
    );
    expect(m.bestRate).toBe(0.5);
    expect(evaluateGate(s, m).kind).toBe('pass');
  });
});

describe('spatial sources skip the parcel gate', () => {
  it('crime (expectedJoinRate undefined) is exempt', () => {
    const crimeSpec = spec('incidents_part1_part2');
    expect(crimeSpec.expectedJoinRate).toBeUndefined();
    expect(crimeSpec.keyColumns).toEqual([]);

    const crime = loadJsonFixture<{ rows: Record<string, unknown>[] }>('crime_spatial.json');
    const m = measureJoinRate(crimeSpec.name, crime.rows, crimeSpec.keyColumns, philadelphia, parcelIndex);
    // No candidate key columns → no per-key rates measured.
    expect(m.perKey).toEqual([]);
    const decision = evaluateGate(crimeSpec, m);
    expect(decision.kind).toBe('exempt_spatial');
  });

  it('311 (public_cases_fc) is likewise exempt', () => {
    const s = spec('public_cases_fc');
    expect(s.expectedJoinRate).toBeUndefined();
    const m = measureJoinRate(s.name, [], s.keyColumns, philadelphia, parcelIndex);
    expect(evaluateGate(s, m).kind).toBe('exempt_spatial');
  });
});
