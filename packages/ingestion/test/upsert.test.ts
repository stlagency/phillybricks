/**
 * Mapping-driven upsert engine tests (PRD §4.1): $N numbering, geometry-expression
 * rendering (never a bound scalar), ON CONFLICT DO UPDATE, row-skip, chunking.
 */
import { describe, it, expect } from 'vitest';
import { ewktGeom, geoJsonGeom, type SourceMapping } from '@bandbox/core';
import { buildMappedUpsert, upsertMapped } from '../src/loaders/upsert.js';
import { FakeDb } from './helpers.js';

const mapping: SourceMapping = {
  targetTable: 'public.thing',
  targetColumns: ['id', 'name', 'geom', 'val'],
  conflictColumns: ['id'],
  mapRow(raw) {
    const id = raw.id == null ? null : String(raw.id);
    if (id === null) return null; // skip
    return {
      id,
      name: raw.name == null ? null : String(raw.name),
      geom: ewktGeom(raw.shape),
      val: raw.val == null ? null : Number(raw.val),
    };
  },
};

describe('buildMappedUpsert', () => {
  it('numbers placeholders $1.. across the whole statement and renders geom as an expression', () => {
    const stmt = buildMappedUpsert(mapping, [
      { id: 'a', name: 'X', geom: ewktGeom('SRID=2272;POINT(1 2)'), val: 5 },
    ])!;
    expect(stmt.query).toContain('insert into public.thing (id, name, geom, val) values');
    // geom is ST_Transform(ST_GeomFromEWKT($n),4326), NOT a bare $n.
    expect(stmt.query).toContain('ST_Transform(ST_GeomFromEWKT($3), 4326)');
    expect(stmt.query).toContain('on conflict (id) do update set name = excluded.name');
    expect(stmt.query).toContain('geom = excluded.geom');
    expect(stmt.query).not.toContain('id = excluded.id'); // conflict key not in update set
    // params: id, name, [geom wkt], val  → geom contributes its wkt text as a param.
    expect(stmt.params).toEqual(['a', 'X', 'SRID=2272;POINT(1 2)', 5]);
  });

  it('renders a null geometry as NULL::geometry with no param', () => {
    const stmt = buildMappedUpsert(mapping, [{ id: 'a', name: null, geom: ewktGeom(''), val: null }])!;
    expect(stmt.query).toContain('NULL::geometry');
    expect(stmt.params).toEqual(['a', null, null]); // geom contributes NO param
  });

  it('renders a GeoJSON marker as ST_GeomFromGeoJSON', () => {
    const stmt = buildMappedUpsert(mapping, [
      { id: '1', name: null, geom: geoJsonGeom('{"type":"Point"}'), val: null },
    ])!;
    expect(stmt.query).toContain('ST_SetSRID(ST_GeomFromGeoJSON(');
  });

  it('numbers params correctly across multiple rows', () => {
    const stmt = buildMappedUpsert(mapping, [
      { id: 'a', name: 'X', geom: ewktGeom(''), val: 1 },
      { id: 'b', name: 'Y', geom: ewktGeom('SRID=2272;POINT(3 4)'), val: 2 },
    ])!;
    // row1: $1 id, $2 name, NULL geom (no param), $3 val; row2: $4 id, $5 name, $6 geom, $7 val
    expect(stmt.query).toContain('ST_Transform(ST_GeomFromEWKT($6), 4326)');
    expect(stmt.params).toEqual(['a', 'X', 1, 'b', 'Y', 'SRID=2272;POINT(3 4)', 2]);
  });

  it('returns null for an empty row set', () => {
    expect(buildMappedUpsert(mapping, [])).toBeNull();
  });
});

describe('upsertMapped', () => {
  it('skips rows mapRow rejects and chunks the rest', async () => {
    const db = new FakeDb();
    const rows = [{ id: 'a' }, { id: null }, { id: 'b' }, { id: 'c' }];
    const res = await upsertMapped(db.client, mapping, rows, 2);
    expect(res.skipped).toBe(1);
    expect(res.promoted).toBe(3);
    // 3 mapped rows at chunk size 2 ⇒ 2 INSERT statements.
    expect(db.indicesOf('insert into public.thing').length).toBe(2);
  });

  it('de-duplicates rows by conflict key within a batch (keep last) — no ON CONFLICT-twice', async () => {
    const db = new FakeDb();
    // 'a' appears twice in one batch (e.g. multiple L&I lines per case) — must collapse.
    const res = await upsertMapped(db.client, mapping, [{ id: 'a', val: 1 }, { id: 'a', val: 2 }, { id: 'b', val: 3 }], 500);
    expect(res.promoted).toBe(2); // distinct keys a, b
    expect(res.deduped).toBe(1);
    const inserts = db.calls.filter((c) => c.query?.includes('insert into public.thing'));
    expect(inserts.length).toBe(1); // one statement, two tuples, no duplicate conflict target
  });

  it('DO NOTHING when updateColumns is empty (append-only)', () => {
    const appendOnly: SourceMapping = { ...mapping, updateColumns: [] };
    const stmt = buildMappedUpsert(appendOnly, [{ id: 'a', name: null, geom: ewktGeom(''), val: null }])!;
    expect(stmt.query).toContain('on conflict (id) do nothing');
  });
});
