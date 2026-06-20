/**
 * M7 skip-trace additions: the DB-backed (global) daily cap and Vault key
 * resolution. Both are exercised with a fake postgres `Sql` tagged-template.
 */
import { describe, it, expect } from 'vitest';
import { createDbUsageStore, getSkiptraceKey, type SqlLike } from '../src/lib/skiptrace';

interface Handler {
  match: RegExp;
  rows: () => unknown[];
}

function fakeSql(handlers: Handler[]) {
  const calls: { q: string; values: unknown[] }[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ');
    calls.push({ q, values });
    for (const h of handlers) if (h.match.test(q)) return Promise.resolve(h.rows());
    return Promise.resolve([]);
  }) as SqlLike & { calls: { q: string; values: unknown[] }[] };
  (fn as unknown as { calls: unknown }).calls = calls;
  return fn;
}

describe('createDbUsageStore', () => {
  it('allows when under cap and blocks when at cap', async () => {
    const underCap = fakeSql([{ match: /select n from app\.skiptrace_usage/i, rows: () => [] }]);
    const store = createDbUsageStore(underCap, 2);
    expect(await store.check('u1')).toEqual({ allowed: true, remaining: 2 });

    const atCap = fakeSql([{ match: /select n from app\.skiptrace_usage/i, rows: () => [{ n: 2 }] }]);
    const blocked = createDbUsageStore(atCap, 2);
    expect(await blocked.check('u1')).toEqual({ allowed: false, remaining: 0 });
  });

  it('record upserts into app.skiptrace_usage', async () => {
    const sql = fakeSql([]);
    const store = createDbUsageStore(sql, 5);
    await store.record('u1');
    expect(sql.calls.some((c) => /insert into app\.skiptrace_usage/i.test(c.q))).toBe(true);
  });
});

describe('getSkiptraceKey (SECURITY DEFINER proxy)', () => {
  it('returns {vendor, apiKey} from app.get_skiptrace_key', async () => {
    const sql = fakeSql([
      {
        match: /from app\.get_skiptrace_key/i,
        rows: () => [{ r_vendor: 'reiskip', r_plaintext: 'PLAINTEXT_KEY' }],
      },
    ]);
    expect(await getSkiptraceKey(sql, 'u1')).toEqual({ vendor: 'reiskip', apiKey: 'PLAINTEXT_KEY' });
  });

  it('returns null when no key is on file', async () => {
    const sql = fakeSql([{ match: /from app\.get_skiptrace_key/i, rows: () => [] }]);
    expect(await getSkiptraceKey(sql, 'u1')).toBeNull();
  });

  it('returns null when the proxy yields no plaintext', async () => {
    const sql = fakeSql([
      { match: /from app\.get_skiptrace_key/i, rows: () => [{ r_vendor: 'endato', r_plaintext: null }] },
    ]);
    expect(await getSkiptraceKey(sql, 'u1')).toBeNull();
  });
});
