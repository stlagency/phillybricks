/**
 * Change-log / event diff tests (PRD §3.3). Asserts the BASELINE-aware SQL shape
 * (first observation → old_value NULL via the lateral latest-value join), the
 * identifier guard, and that the diff runners issue the expected statements.
 */
import { describe, it, expect } from 'vitest';
import {
  PARCEL_CHANGE_LOG_FIELDS,
  buildFieldChangeLogSql,
  runParcelChangeLog,
  runDelinquencyEventDiff,
  runViolationEventDiff,
} from '../src/loaders/changeLog.js';
import { FakeDb } from './helpers.js';

describe('buildFieldChangeLogSql (baseline convention)', () => {
  it('emits a baseline-aware insert: latest new_value vs current, IS DISTINCT FROM', () => {
    const sql = buildFieldChangeLogSql('public.parcel', 'parcel_pk', 'market_value');
    expect(sql).toContain('insert into public.parcel_change_log');
    expect(sql).toContain("'market_value' as field");
    expect(sql).toContain('latest.new_value as old_value'); // NULL on first observation
    expect(sql).toContain('s.market_value::text as new_value');
    expect(sql).toContain('current_date as changed_on');
    expect(sql).toContain('is distinct from s.market_value::text'); // only writes on a real change
    expect(sql).toContain('order by cl.changed_on desc, cl.id desc'); // latest wins
    expect(sql).toContain('s.is_active = true');
  });

  it('rejects an unsafe identifier (no injection through the field name)', () => {
    expect(() => buildFieldChangeLogSql('public.parcel', 'parcel_pk', 'market_value; drop table')).toThrow(
      /unsafe identifier/,
    );
    expect(() => buildFieldChangeLogSql('public.parcel', 'pk--', 'x')).toThrow(/unsafe identifier/);
  });
});

describe('runParcelChangeLog', () => {
  it('issues one insert per tracked field and sums the counts', async () => {
    const db = new FakeDb().on('insert into public.parcel_change_log', () => [{ n: 7 }]);
    const written = await runParcelChangeLog(db.client);
    expect(written).toBe(7 * PARCEL_CHANGE_LOG_FIELDS.length);
    expect(db.indicesOf('insert into public.parcel_change_log').length).toBe(PARCEL_CHANGE_LOG_FIELDS.length);
  });
});

describe('event diffs', () => {
  it('delinquency: appeared/reappeared then cleared (two statements)', async () => {
    const db = new FakeDb().on('insert into public.delinquency_event', () => [{ n: 3 }]);
    const n = await runDelinquencyEventDiff(db.client);
    expect(n).toBe(6); // 3 + 3
    const inserts = db.calls.filter((c) => c.query?.includes('insert into public.delinquency_event'));
    expect(inserts.length).toBe(2);
    expect(inserts[0]?.query).toContain("'appeared'");
    expect(inserts[1]?.query).toContain("'cleared'");
  });

  it('violation: standing pattern keyed on violation_id, open predicate excludes closed', async () => {
    const db = new FakeDb().on('insert into public.violation_event', () => [{ n: 1 }]);
    await runViolationEventDiff(db.client);
    const inserts = db.calls.filter((c) => c.query?.includes('insert into public.violation_event'));
    expect(inserts.length).toBe(2);
    expect(inserts[0]?.query).toContain('CLOSED'); // open predicate references terminal states
    expect(inserts[0]?.query).toContain('distinct on (violation_id)');
  });
});
