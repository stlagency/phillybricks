/**
 * Pipeline ordering + gate-behavior tests (PRD §4.1, §3.1).
 *
 * Asserts the §4.1 invariant structurally: promote runs inside a transaction and
 * diff + refresh + tiles run ONLY after a full-batch promote; a quarantined batch
 * promotes NOTHING and still does not halt.
 */
import { describe, it, expect, vi } from 'vitest';
import { philadelphia } from '@bandbox/core';
import type { SourceSpec } from '@bandbox/core/contracts';
import { runSourcePipeline, type PipelineHooks, type SourceSteps, type StagedBatch } from '../src/pipeline.js';
import { loadJsonFixture, loadParcelIndexFixture, FakeDb } from './helpers.js';

const parcelIndex = loadParcelIndexFixture();

function spec(name: string): SourceSpec {
  const s = philadelphia.sources.find((x) => x.name === name)!;
  return s;
}

function recordingSteps(order: string[]): SourceSteps {
  return {
    async promote(_tx, batch) {
      order.push('promote');
      return batch.rows.length;
    },
    async diff() {
      order.push('diff');
      return 0;
    },
    async refreshDerived() {
      order.push('refreshDerived');
    },
  };
}

function spyHooks(events: string[]): PipelineHooks {
  return {
    alert: vi.fn((e) => {
      events.push(`alert:${e.kind}`);
    }),
    triggerTileBuild: vi.fn(() => {
      events.push('tiles');
    }),
  };
}

describe('pipeline ordering invariant (PRD §4.1)', () => {
  it('promote runs in a transaction, then diff → refresh → tiles, in that order', async () => {
    const order: string[] = [];
    const events: string[] = [];
    const db = new FakeDb();
    const batch: StagedBatch = {
      source: 'permits',
      rows: [
        { opa_account_num: '523045600' },
        { opa_account_num: '351243300' },
        { opa_account_num: '881000000' },
      ],
    };
    // Override permits threshold via a clone with a low expectedJoinRate so this
    // 3/3 batch passes deterministically.
    const permitsSpec: SourceSpec = { ...spec('permits'), expectedJoinRate: 0.5 };

    const outcome = await runSourcePipeline({
      db: db.client,
      adapter: philadelphia,
      spec: permitsSpec,
      batch,
      parcelIndex,
      steps: recordingSteps(order),
      hooks: spyHooks(events),
      ingestRunId: 1,
    });

    expect(outcome.status).toBe('promoted');
    expect(outcome.rowsPromoted).toBe(3);
    // The exact §4.1 order.
    expect(order).toEqual(['promote', 'diff', 'refreshDerived']);
    // promote must have happened inside a transaction boundary.
    expect(db.firstIndexOfKind('begin')).toBeGreaterThanOrEqual(0);
    // tiles fire after derived refresh.
    expect(events).toContain('tiles');
  });

  it('a QUARANTINED batch promotes nothing and never runs diff/refresh/tiles', async () => {
    const order: string[] = [];
    const events: string[] = [];
    const db = new FakeDb();
    const rtt = loadJsonFixture<{ rows: Record<string, unknown>[] }>('rtt_below_threshold.json');
    const batch: StagedBatch = { source: 'rtt_summary', rows: rtt.rows };

    const outcome = await runSourcePipeline({
      db: db.client,
      adapter: philadelphia,
      spec: spec('rtt_summary'), // threshold 0.6, batch is 0.30
      batch,
      parcelIndex,
      steps: recordingSteps(order),
      hooks: spyHooks(events),
      ingestRunId: 7,
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.rowsPromoted).toBe(0);
    // NONE of the post-promote steps ran.
    expect(order).toEqual([]);
    expect(db.firstIndexOfKind('begin')).toBe(-1);
    // It alerted (quarantine) but did NOT throw — the run continues.
    expect(events).toContain('alert:gate_quarantine');
    expect(events).not.toContain('tiles');
  });

  it('an EMPTY batch is a clean no-op (a drained/lagging source must not quarantine)', async () => {
    const order: string[] = [];
    const events: string[] = [];
    const db = new FakeDb();
    const outcome = await runSourcePipeline({
      db: db.client,
      adapter: philadelphia,
      spec: spec('imm_dang'), // non-spatial, threshold 0.9
      batch: { source: 'imm_dang', rows: [] },
      parcelIndex,
      steps: recordingSteps(order),
      hooks: spyHooks(events),
      ingestRunId: 1,
    });
    expect(outcome.status).toBe('promoted');
    expect(outcome.rowsPromoted).toBe(0);
    expect(order).toEqual([]); // no promote/diff/refresh on an empty batch
    expect(events).not.toContain('alert:gate_quarantine'); // and crucially NO false quarantine
    expect(db.firstIndexOfKind('begin')).toBe(-1);
  });

  it('does not throw on a below-threshold batch (gate ≠ halt)', async () => {
    const db = new FakeDb();
    const rtt = loadJsonFixture<{ rows: Record<string, unknown>[] }>('rtt_below_threshold.json');
    await expect(
      runSourcePipeline({
        db: db.client,
        adapter: philadelphia,
        spec: spec('rtt_summary'),
        batch: { source: 'rtt_summary', rows: rtt.rows },
        parcelIndex,
        steps: recordingSteps([]),
        hooks: spyHooks([]),
        ingestRunId: null,
      }),
    ).resolves.toMatchObject({ status: 'quarantined' });
  });
});

describe('spatial source path', () => {
  it('promotes a spatial batch without a parcel gate, reporting exempt_spatial', async () => {
    const order: string[] = [];
    const events: string[] = [];
    const db = new FakeDb();
    const crime = loadJsonFixture<{ rows: Record<string, unknown>[] }>('crime_spatial.json');
    const batch: StagedBatch = {
      source: 'incidents_part1_part2',
      rows: crime.rows,
      geomValidCount: crime.rows.length, // all geom valid
    };

    const outcome = await runSourcePipeline({
      db: db.client,
      adapter: philadelphia,
      spec: spec('incidents_part1_part2'),
      batch,
      parcelIndex,
      steps: recordingSteps(order),
      hooks: spyHooks(events),
      ingestRunId: 3,
    });

    expect(outcome.status).toBe('promoted');
    expect(outcome.decision.kind).toBe('exempt_spatial');
    expect(outcome.measurement).toBeNull();
    expect(order).toEqual(['promote', 'diff', 'refreshDerived']);
    // No quarantine alert for a clean spatial batch.
    expect(events).not.toContain('alert:spatial_geom_low');
  });

  it('alerts (but still promotes) when spatial geom-valid ratio is below the floor', async () => {
    const events: string[] = [];
    const db = new FakeDb();
    const crime = loadJsonFixture<{ rows: Record<string, unknown>[] }>('crime_spatial.json');
    const batch: StagedBatch = {
      source: 'incidents_part1_part2',
      rows: crime.rows,
      geomValidCount: 1, // 1 of 3 valid → 0.33 < 0.95 floor
    };

    const outcome = await runSourcePipeline({
      db: db.client,
      adapter: philadelphia,
      spec: spec('incidents_part1_part2'),
      batch,
      parcelIndex,
      steps: recordingSteps([]),
      hooks: spyHooks(events),
      ingestRunId: 4,
    });

    expect(outcome.status).toBe('promoted'); // spatial is best-effort
    expect(events).toContain('alert:spatial_geom_low');
  });
});

describe('malformed-key quarantine persistence', () => {
  it('persists malformed keys to ops.parcel_key_quarantine and bumps the count', async () => {
    const db = new FakeDb();
    const batch: StagedBatch = {
      source: 'permits',
      rows: [
        { opa_account_num: '523045600' }, // joins
        { opa_account_num: '351243300' }, // joins
        { opa_account_num: 'GARBAGE' }, // non-numeric → null both candidates → malformed
        { opa_account_num: '1234567890' }, // 10-digit → null → malformed
      ],
    };
    const permitsSpec: SourceSpec = { ...spec('permits'), expectedJoinRate: 0.4 };

    await runSourcePipeline({
      db: db.client,
      adapter: philadelphia,
      spec: permitsSpec,
      batch,
      parcelIndex,
      steps: recordingSteps([]),
      hooks: spyHooks([]),
      ingestRunId: 42,
    });

    // The quarantine insert + the malformed_key_count bump both happened.
    expect(db.indicesOf('insert into ops.parcel_key_quarantine').length).toBe(1);
    expect(db.indicesOf('malformed_key_count = malformed_key_count').length).toBe(1);
  });
});
