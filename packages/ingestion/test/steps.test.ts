/**
 * Steps tests (PRD §3.2, §4.1). The CRITICAL safety invariant: soft-retire must
 * NEVER run on an empty batch (a freshness skip) — an empty batch would otherwise
 * retire every parcel. Also: it retires exactly the canonical-active keys absent
 * from the loaded set, and reactivation is handled by the upsert (is_active=true).
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '@bandbox/core';
import type { SourceMapping } from '@bandbox/core/contracts';
import { softRetireParcels } from '../src/steps.js';
import type { StagedBatch } from '../src/pipeline.js';
import { FakeDb } from './helpers.js';

const opaMapping = philadelphia.sources.find((s) => s.name === 'opa_properties_public')!.mapping as SourceMapping;

describe('softRetireParcels (PRD §3.2)', () => {
  it('NEVER retires on an empty batch (freshness skip)', async () => {
    const db = new FakeDb().on('select parcel_pk from public.parcel', () => [
      { parcel_pk: '000000001' },
      { parcel_pk: '000000002' },
    ]);
    const batch: StagedBatch = { source: 'opa_properties_public', rows: [] };
    const retired = await softRetireParcels(db.client, opaMapping, batch);
    expect(retired).toBe(0);
    // no UPDATE issued
    expect(db.indicesOf('update public.parcel set is_active = false').length).toBe(0);
  });

  it('retires only canonical-active keys absent from the loaded batch', async () => {
    // canonical active = {1,2,3}; loaded = {1,3,4} ⇒ retire {2}
    const db = new FakeDb().on('select parcel_pk from public.parcel', () => [
      { parcel_pk: '000000001' },
      { parcel_pk: '000000002' },
      { parcel_pk: '000000003' },
    ]);
    const batch: StagedBatch = {
      source: 'opa_properties_public',
      rows: [
        { parcel_number: '000000001', shape: '' },
        { parcel_number: '000000003', shape: '' },
        { parcel_number: '000000004', shape: '' },
      ],
    };
    const retired = await softRetireParcels(db.client, opaMapping, batch);
    expect(retired).toBe(1);
    const upd = db.calls.find((c) => c.query?.includes('update public.parcel set is_active = false'));
    expect(upd?.params).toEqual(['000000002']); // exactly the disappeared key
  });

  it('does NOT retire when the loaded set is empty after mapping (defensive)', async () => {
    const db = new FakeDb().on('select parcel_pk from public.parcel', () => [{ parcel_pk: '000000001' }]);
    // rows present but all map to null parcel_pk (e.g. >9-digit ids) ⇒ loaded set empty ⇒ no retire
    const batch: StagedBatch = {
      source: 'opa_properties_public',
      rows: [{ parcel_number: '1234567890', shape: '' }],
    };
    const retired = await softRetireParcels(db.client, opaMapping, batch);
    expect(retired).toBe(0);
  });
});
