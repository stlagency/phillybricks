/**
 * Distress matview ↔ scorer PARITY (PRD §3.4 / §5.3). The composite scored in SQL by
 * public.distress_signal must equal the TS scoreDistress used by the deep-dive — both
 * generated from DISTRESS_CONFIG. These tests prove:
 *   1. normalizeNumeric (the SQL formula's JS twin) === scoreDistress's per-component
 *      `normalized` across a value grid (null/negative/zero/mid/cap/over-cap/bool).
 *   2. compositeNumeric === scoreDistress.score01 for random parcels.
 *   3. the live 0011 migration embeds EXACTLY buildDistressSignalDDL() (drift gate).
 *   4. normalizeSql emits the documented canonical SQL forms.
 * (A live spot-check on prod — read the matview, re-score in TS, compare — closes the
 * loop against the deployed SQL on real parcels.)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DISTRESS_CONFIG, DISTRESS_COMPONENT_KEYS } from '../src/scoring/config.js';
import { scoreDistress } from '../src/scoring/distress.js';
import {
  normalizeNumeric,
  normalizeSql,
  compositeNumeric,
  buildDistressSignalDDL,
} from '../src/scoring/distressSql.js';
import type { DistressComponentKey } from '../src/contracts/index.js';

const GRID = [null, -5, -1, 0, 1, 2, 3, 4, 5, 6, 100, 1000, 25000, 30000, 0.2, 0.4, 0.5, 1.5];

describe('normalizeNumeric === scoreDistress per-component normalized', () => {
  for (const key of DISTRESS_COMPONENT_KEYS) {
    const desc = DISTRESS_CONFIG.components[key].normalize;
    const raws: (number | boolean | null)[] =
      desc.kind === 'boolean' ? [null, false, true, 0, 1] : GRID;
    for (const raw of raws) {
      it(`${key} @ ${String(raw)}`, () => {
        const result = scoreDistress({ parcel_pk: 'x', signals: { [key]: raw } });
        const comp = result.components.find((c) => c.component === key)!;
        expect(normalizeNumeric(raw, desc)).toBeCloseTo(comp.normalized, 12);
      });
    }
  }
});

describe('compositeNumeric === scoreDistress.score01', () => {
  // Deterministic pseudo-random parcels (no Math.random in tests).
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (1103515245 * s + 12345) & 0x7fffffff) / 0x7fffffff);
  }
  it('matches across 200 random signal vectors', () => {
    const rnd = lcg(42);
    for (let i = 0; i < 200; i++) {
      const signals: Partial<Record<DistressComponentKey, number | boolean | null>> = {};
      for (const key of DISTRESS_COMPONENT_KEYS) {
        const desc = DISTRESS_CONFIG.components[key].normalize;
        if (desc.kind === 'boolean') signals[key] = rnd() > 0.5;
        else signals[key] = rnd() < 0.1 ? null : Math.round(rnd() * desc.cap * 1.5 * 100) / 100;
      }
      const core = scoreDistress({ parcel_pk: `p${i}`, signals }).score01;
      expect(compositeNumeric(signals)).toBeCloseTo(core, 12);
    }
  });
});

describe('migration 0011 embeds the generated distress DDL (drift gate)', () => {
  it('the GENERATED block equals buildDistressSignalDDL()', () => {
    const path = fileURLToPath(new URL('../../db/migrations/0011_m3_derived.sql', import.meta.url));
    const sql = readFileSync(path, 'utf8');
    const begin = '-- BEGIN GENERATED distress_signal';
    const end = '-- END GENERATED distress_signal';
    const startIdx = sql.indexOf(begin);
    const endIdx = sql.indexOf(end);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    // Content strictly between the marker LINES.
    const afterBegin = sql.indexOf('\n', startIdx) + 1;
    const block = sql.slice(afterBegin, endIdx).trim();
    expect(block).toBe(buildDistressSignalDDL().trim());
  });
});

describe('normalizeSql emits the documented canonical forms', () => {
  it('boolean → case-when', () => {
    expect(normalizeSql('flag', { kind: 'boolean' })).toBe('(case when flag then 1.0 else 0.0 end)');
  });
  it('linear_cap → clamp/cap', () => {
    expect(normalizeSql('x', { kind: 'linear_cap', cap: 25000, unit: 'dollars' })).toBe(
      '(least(greatest(coalesce(x, 0)::numeric, 0), 25000) / 25000::numeric)',
    );
  });
});
