/**
 * Worker orchestration tests (PRD §4.1) — the scrape path through runWorker +
 * buildRegistries, which the parser/mapping unit tests don't exercise. The
 * load-bearing invariants: a scrape promotes via the dedicated path (no join-rate
 * gate, no soft-retire, no cursor advance); a fetcher throw becomes a `failed` run +
 * alert WITHOUT halting the other sources; and buildRegistries wires the scrape
 * source only when scraper.sourceName matches its SourceSpec.name.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '@bandbox/core';
import type { SourceSpec } from '@bandbox/core/contracts';
import { buildRegistries, runWorker, type SourceFetcher, type WorkerDeps } from '../src/run.js';
import { makeStepsForSpec } from '../src/steps.js';
import type { AlertEvent, StagedBatch } from '../src/pipeline.js';
import { FakeDb } from './helpers.js';

const sheriffSpec = philadelphia.sources.find((s) => s.name === 'sheriff_sales')!;

/** A FakeDb wired so openIngestRun returns an id and the parcel index loads. */
function workerDb(): FakeDb {
  return new FakeDb()
    .on('insert into ops.ingest_run', () => [{ id: 1 }])
    .on('select parcel_pk from public.parcel', () => [{ parcel_pk: '522145900' }]);
}

/** Recording hooks so we can assert alerts (and never throw upward). */
function recordingHooks(): { hooks: WorkerDeps['hooks']; alerts: AlertEvent[]; tiles: string[] } {
  const alerts: AlertEvent[] = [];
  const tiles: string[] = [];
  return {
    alerts,
    tiles,
    hooks: {
      alert: (e) => {
        alerts.push(e);
      },
      triggerTileBuild: (s) => {
        tiles.push(s);
      },
    },
  };
}

/** A raw scrape row as the fetcher would produce it (header-keyed + injected page ctx). */
const scrapeRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ID: '1', BooknWrit: '2602-371', AssessmentID: '522145900', Street: 'X',
  SaleType: 'MORTGAGE FORECLOSURE', SaleStatus: 'Preview', SaleDate: '2026-07-07',
  __sale_type: 'mortgage', __source_url: 'https://phillysheriff.test/mortgage/', ...over,
});

const fakeFetcher = (batch: StagedBatch): SourceFetcher => async () => batch;

describe('runWorker — scrape path', () => {
  it('promotes a scrape via the dedicated path: success, no soft-retire, no cursor advance', async () => {
    const db = workerDb();
    const { hooks, tiles } = recordingHooks();
    const batch: StagedBatch = {
      source: 'sheriff_sales',
      rows: [scrapeRow(), scrapeRow({ BooknWrit: '2607-301', SaleStatus: 'Postponed' })],
      nextCursor: null,
    };
    const reports = await runWorker(db.client, {
      fetchers: { sheriff_sales: fakeFetcher(batch) },
      stepsBySource: { sheriff_sales: makeStepsForSpec(sheriffSpec) },
      hooks,
    });
    const r = reports.find((x) => x.source === 'sheriff_sales')!;
    expect(r.status).toBe('success');
    expect(r.rowsPromoted).toBe(2);
    // promote ran inside a transaction, upserting the canonical table
    expect(db.firstIndexOfKind('begin')).toBeGreaterThanOrEqual(0);
    expect(db.indicesOf('insert into public.sheriff_listing').length).toBe(1);
    // run opened + closed
    expect(db.indicesOf('insert into ops.ingest_run').length).toBe(1);
    expect(db.indicesOf('update ops.ingest_run').length).toBe(1);
    // NOT the keyed/spine paths: no soft-retire, no keyset cursor write
    expect(db.indicesOf('update public.parcel set is_active = false').length).toBe(0);
    expect(db.indicesOf('insert into ops.source_cursor').length).toBe(0);
    expect(tiles).toContain('sheriff_sales');
  });

  it('an empty scrape closes cleanly (success, 0 promoted) — no diff/cursor side effects', async () => {
    const db = workerDb();
    const { hooks, tiles } = recordingHooks();
    const reports = await runWorker(db.client, {
      fetchers: { sheriff_sales: fakeFetcher({ source: 'sheriff_sales', rows: [], nextCursor: null }) },
      stepsBySource: { sheriff_sales: makeStepsForSpec(sheriffSpec) },
      hooks,
    });
    const r = reports.find((x) => x.source === 'sheriff_sales')!;
    expect(r.status).toBe('success');
    expect(r.rowsPromoted).toBe(0);
    expect(db.indicesOf('update ops.ingest_run').length).toBe(1); // still closed
    expect(db.indicesOf('insert into ops.source_cursor').length).toBe(0);
    expect(tiles).not.toContain('sheriff_sales'); // no tile build on an empty batch
  });

  it('a fetcher throw becomes a failed run + alert and does NOT halt other sources', async () => {
    const db = workerDb();
    const { hooks, alerts } = recordingHooks();
    const permitsSpec = philadelphia.sources.find((s) => s.name === 'permits')!;
    const throwing: SourceFetcher = async () => {
      throw new Error('boom: thead drift');
    };
    const goodBatch: StagedBatch = { source: 'sheriff_sales', rows: [scrapeRow()], nextCursor: null };
    const reports = await runWorker(db.client, {
      fetchers: { permits: throwing, sheriff_sales: fakeFetcher(goodBatch) },
      stepsBySource: {
        permits: makeStepsForSpec(permitsSpec),
        sheriff_sales: makeStepsForSpec(sheriffSpec),
      },
      hooks,
    });
    const permits = reports.find((x) => x.source === 'permits')!;
    const sheriff = reports.find((x) => x.source === 'sheriff_sales')!;
    expect(permits.status).toBe('failed');
    expect(permits.error).toMatch(/thead drift/);
    expect(alerts.some((a) => a.kind === 'source_error' && a.source === 'permits')).toBe(true);
    // the later source still ran to success — one failure never halts the run
    expect(sheriff.status).toBe('success');
    expect(sheriff.rowsPromoted).toBe(1);
  });
});

describe('buildRegistries — scrape wiring', () => {
  it('wires the scrape source alongside the spine + carto sources', () => {
    const { fetchers, stepsBySource } = buildRegistries();
    expect(fetchers.sheriff_sales).toBeTypeOf('function');
    expect(stepsBySource.sheriff_sales).toBeDefined();
    // sanity: the scrape branch did not break the spine / carto wiring
    expect(fetchers.opa_properties_public).toBeTypeOf('function');
    expect(fetchers.permits).toBeTypeOf('function');
  });

  it('every wired source has BOTH a fetcher and steps (no half-wired source)', () => {
    const { fetchers, stepsBySource } = buildRegistries();
    for (const name of Object.keys(fetchers)) expect(stepsBySource[name]).toBeDefined();
    for (const name of Object.keys(stepsBySource)) expect(fetchers[name]).toBeDefined();
  });
});
