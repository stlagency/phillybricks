/**
 * M3 derived plumbing (PRD §3.4 / §5.4): geo-stamp, geo_metric recompute, and the
 * end-of-run finalize — driven through the in-memory FakeDb (no socket). Asserts SQL
 * shape (grain, class labels, lens metrics, incremental floor), refresh path selection,
 * and finalize ordering (stamp → comp_candidate → distress_signal → geo_metric).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FakeDb } from './helpers.js';
import { stampGeoColumn, stampAllGeo } from '../src/loaders/geoStamp.js';
import { recomputeGeoMetrics } from '../src/loaders/geoMetric.js';
import { refreshMatview, finalizeDerived } from '../src/finalize.js';

describe('geo-stamp SQL', () => {
  it('incremental stamp targets the right column, point-in-polygon, NULL-only', async () => {
    const db = new FakeDb().on('count(*)::int as n from upd', () => [{ n: 7 }]);
    const n = await stampGeoColumn(db.client, 'public.parcel', 'neighborhood');
    expect(n).toBe(7);
    const q = db.calls.find((c) => c.kind === 'unsafe')!.query!;
    expect(q).toContain('update public.parcel t');
    expect(q).toContain('set neighborhood_id =');
    expect(q).toContain('ST_Contains(b.geom, t.geom)');
    expect(q).toContain('and t.neighborhood_id is null'); // incremental
    expect(db.calls[0]!.params).toEqual(['neighborhood']);
  });

  it('force stamp drops the NULL-only guard', async () => {
    const db = new FakeDb().on('count(*)::int as n from upd', () => [{ n: 0 }]);
    await stampGeoColumn(db.client, 'public.crime_incident', 'zip', true);
    const q = db.calls.find((c) => c.kind === 'unsafe')!.query!;
    expect(q).toContain('set zip_id =');
    expect(q).not.toContain('is null');
  });

  it('stampAllGeo runs 3 tables × 3 geo types = 9 statements', async () => {
    const db = new FakeDb().on('count(*)::int as n from upd', () => [{ n: 0 }]);
    const res = await stampAllGeo(db.client);
    expect(res).toHaveLength(9);
    expect(db.calls.filter((c) => c.kind === 'unsafe')).toHaveLength(9);
  });
});

describe('geo_metric recompute SQL', () => {
  it('runs 6 class-a + 5 class-b per geo type (33 total) with correct grain + classes', async () => {
    const db = new FakeDb();
    const res = await recomputeGeoMetrics(db.client, {});
    expect(res.classAStatements).toBe(18);
    expect(res.classBStatements).toBe(15);
    const queries = db.calls.filter((c) => c.kind === 'unsafe').map((c) => c.query!);
    expect(queries).toHaveLength(33);
    for (const q of queries) {
      expect(q).toContain('on conflict (geo_type, geo_id, period, metric) do update');
    }
    // every lens metric present
    const all = queries.join('\n');
    for (const m of ['median_price_per_sqft', 'permit_count', 'distress_share', 'livability_index']) {
      expect(all).toContain(`'${m}'`);
    }
    expect(queries.filter((q) => q.includes("'a_backfillable'"))).toHaveLength(18);
    expect(queries.filter((q) => q.includes("'b_forward_accruing'"))).toHaveLength(15);
  });

  it('nightly default applies a trailing floor; backfill does not', async () => {
    const inc = new FakeDb();
    await recomputeGeoMetrics(inc.client, { trailingMonths: 3 });
    const incQ = inc.calls.filter((c) => c.kind === 'unsafe').map((c) => c.query!).join('\n');
    expect(incQ).toContain("interval '3 months'");

    const full = new FakeDb();
    await recomputeGeoMetrics(full.client, { backfill: true });
    const fullQ = full.calls.filter((c) => c.kind === 'unsafe').map((c) => c.query!).join('\n');
    expect(fullQ).not.toContain('current_date - interval');
  });
});

describe('refreshMatview path selection', () => {
  it('CONCURRENTLY when populated', async () => {
    const db = new FakeDb().on('relispopulated', () => [{ populated: true }]);
    expect(await refreshMatview(db.client, 'distress_signal')).toBe('concurrent');
    const q = db.calls.find((c) => c.query?.includes('refresh materialized view'))!.query!;
    expect(q).toContain('concurrently public.distress_signal');
  });

  it('non-concurrent populate when not yet populated', async () => {
    const db = new FakeDb().on('relispopulated', () => [{ populated: false }]);
    expect(await refreshMatview(db.client, 'comp_candidate')).toBe('full');
    const q = db.calls.find((c) => c.query?.includes('refresh materialized view'))!.query!;
    expect(q).toContain('refresh materialized view public.comp_candidate');
    expect(q).not.toContain('concurrently');
  });

  it('refuses an unknown matview', async () => {
    const db = new FakeDb();
    await expect(refreshMatview(db.client, 'parcel' as never)).rejects.toThrow(/unknown matview/);
  });
});

describe('finalizeDerived ordering', () => {
  it('stamp → comp_candidate → distress_signal → geo_metric (boundaries already loaded)', async () => {
    const db = new FakeDb()
      .on('select 1 from public.geo_boundary', () => [{ x: 1 }]) // non-empty → skip network load
      .on('relispopulated', () => [{ populated: true }])
      .on('count(*)::int as n from upd', () => [{ n: 0 }]);

    const res = await finalizeDerived(db.client, { log: () => {} });
    expect(res.boundariesLoaded).toBeNull();
    expect(res.stamps).toHaveLength(9);
    expect(res.refreshes).toEqual({ comp_candidate: 'concurrent', distress_signal: 'concurrent' });

    const stampIdx = Math.max(...db.indicesOf('set neighborhood_id ='));
    const compIdx = Math.min(...db.indicesOf('concurrently public.comp_candidate'));
    const distrIdx = Math.min(...db.indicesOf('concurrently public.distress_signal'));
    const geoMetricIdx = Math.min(...db.indicesOf('into public.geo_metric'));
    expect(stampIdx).toBeLessThan(compIdx);
    expect(compIdx).toBeLessThan(distrIdx);
    expect(distrIdx).toBeLessThan(geoMetricIdx);
  });

  it('is idempotent — two sequential runs return identical reports', async () => {
    const make = () =>
      new FakeDb()
        .on('select 1 from public.geo_boundary', () => [{ x: 1 }])
        .on('relispopulated', () => [{ populated: true }])
        .on('count(*)::int as n from upd', () => [{ n: 0 }]);
    const a = await finalizeDerived(make().client, { log: () => {} });
    const b = await finalizeDerived(make().client, { log: () => {} });
    expect(a.boundariesLoaded).toBeNull();
    expect(b.boundariesLoaded).toBeNull();
    expect(a.refreshes).toEqual(b.refreshes);
    expect(a.stamps).toEqual(b.stamps);
    expect(a.stamps.every((s) => s.stamped === 0)).toBe(true);
    expect(a.geoMetric).toEqual(b.geoMetric);
  });

  it('first run — empty boundaries loaded, unpopulated matviews get a non-concurrent populate', async () => {
    // Mock the boundary GeoJSON fetch (one feature carrying all three idFields).
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { NAME: 'Passyunk', CODE: '19148', GEOID10: '42101003300' },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
          },
        ],
      }),
    }));
    const db = new FakeDb()
      .on('select 1 from public.geo_boundary', () => []) // empty → load boundaries
      .on('relispopulated', () => [{ populated: false }]) // never populated → full refresh
      .on('count(*)::int as n from upd', () => [{ n: 1 }]);

    const res = await finalizeDerived(db.client, { log: () => {} });
    expect(res.boundariesLoaded).not.toBeNull();
    expect(res.boundariesLoaded!.map((r) => r.kind).sort()).toEqual(['neighborhood', 'tract', 'zip']);
    expect(res.boundariesLoaded!.every((r) => r.inserted === 1)).toBe(true);
    expect(res.refreshes).toEqual({ comp_candidate: 'full', distress_signal: 'full' });
    // A fresh boundary load forces a full re-stamp (force=true → no NULL-only guard).
    const stampQ = db.calls.find((c) => c.kind === 'unsafe' && c.query?.includes('set neighborhood_id ='))!.query!;
    expect(stampQ).not.toContain('is null');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
