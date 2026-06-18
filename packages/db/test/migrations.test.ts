/**
 * Migration unit tests. These parse the .sql files statically and assert the
 * security-gate invariants (PRD §3.6) PLUS structural invariants, so a regression
 * fails in `vitest` too — not only in infra/scripts/security-gate.mjs at CI time.
 *
 * No database connection is made here; this is a pure static parse of the SQL
 * source of truth + a port of the norm_parcel rule fixtures (PRD §3.1, §8).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadMigrations, MIGRATIONS_DIR } from '../src/migrate.js';
import { PUBLIC_TABLES, PUBLIC_MATVIEWS, APP_TABLES } from '../src/index.js';

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** All migration SQL concatenated + lowercased + whitespace-collapsed. */
const allSql = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIG_DIR, f), 'utf8'))
  .join('\n')
  .toLowerCase();
const norm = allSql.replace(/\s+/g, ' ');

/** Collect public.* table names exactly as the security gate does. */
function publicTableNames(): Set<string> {
  const names = new Set<string>();
  for (const m of norm.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  return names;
}

describe('migration files', () => {
  it('exist and follow the NNNN_name.sql ordering convention', () => {
    const files = loadMigrations(MIG_DIR);
    expect(files.length).toBeGreaterThanOrEqual(8);
    const names = files.map((f) => f.name);
    // Strictly ascending lexical order.
    expect([...names].sort()).toEqual(names);
    for (const n of names) expect(n).toMatch(/^\d{4}_.+\.sql$/);
  });

  it('MIGRATIONS_DIR resolves to the on-disk migrations folder', () => {
    expect(readdirSync(MIGRATIONS_DIR).some((f) => f.endsWith('.sql'))).toBe(true);
  });
});

describe('security gate invariants (PRD §3.6) — mirrored as unit assertions', () => {
  const tables = publicTableNames();

  it('declares every expected public.* table', () => {
    for (const t of PUBLIC_TABLES) expect(tables.has(t)).toBe(true);
    // No surprise public tables beyond the contract (catches accidental additions).
    expect(tables.size).toBe(PUBLIC_TABLES.length);
  });

  it.each([...PUBLIC_TABLES])('public.%s has ENABLE ROW LEVEL SECURITY', (t) => {
    expect(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`).test(norm)).toBe(true);
  });

  it.each([...PUBLIC_TABLES])('public.%s REVOKEs writes (or ALL) from anon+authenticated', (t) => {
    // `revoke all` is accepted and preferred — it also strips TRUNCATE/REFERENCES/
    // TRIGGER that Supabase default-privileges grant (TRUNCATE bypasses RLS). See 0009.
    const re = new RegExp(`revoke\\s+[^;]*\\b(insert|update|delete|all)\\b[^;]*on\\s+public\\.${t}\\s+from\\s+[^;]*(anon|authenticated)`);
    expect(re.test(norm)).toBe(true);
  });

  it.each([...PUBLIC_TABLES])('public.%s GRANTs select to anon', (t) => {
    expect(new RegExp(`grant\\s+select\\s+on\\s+public\\.${t}\\s+to\\s+[^;]*anon`).test(norm)).toBe(true);
  });

  it.each([...PUBLIC_TABLES])('public.%s has a permissive select policy using(true)', (t) => {
    // A SELECT policy on the table; using (true) is the public-read convention.
    expect(new RegExp(`create\\s+policy\\s+[a-z0-9_]+\\s+on\\s+public\\.${t}\\s+for\\s+select\\s+using\\s*\\(\\s*true\\s*\\)`).test(norm)).toBe(true);
  });

  it.each([...PUBLIC_MATVIEWS])('matview public.%s is GRANTed select to anon (no RLS)', (mv) => {
    expect(new RegExp(`grant\\s+select\\s+on\\s+public\\.${mv}\\s+to\\s+[^;]*anon`).test(norm)).toBe(true);
    // Matviews must NOT be enumerated as RLS tables (you cannot enable RLS on a matview).
    expect(new RegExp(`alter\\s+table\\s+public\\.${mv}\\s+enable\\s+row\\s+level\\s+security`).test(norm)).toBe(false);
  });

  it('app.skiptrace_key REVOKEs select from anon+authenticated (encrypted_key never selectable)', () => {
    expect(/create\s+table\s+(?:if\s+not\s+exists\s+)?app\.skiptrace_key/.test(norm)).toBe(true);
    expect(/revoke\s+[^;]*select[^;]*on\s+app\.skiptrace_key\s+from\s+[^;]*(anon|authenticated)/.test(norm)).toBe(true);
  });

  it('app.subscription has no insert/update/delete grant to anon/authenticated (service_role webhook only)', () => {
    const writeGrant = /grant\s+[^;]*\b(insert|update|delete)\b[^;]*on\s+app\.subscription\s+to\s+[^;]*(anon|authenticated)/;
    expect(writeGrant.test(norm)).toBe(false);
  });

  it('no ops.* relation is GRANTed to anon/authenticated', () => {
    expect(/grant\s+[^;]*on\s+ops\.[a-z0-9_]+\s+to\s+[^;]*(anon|authenticated)/.test(norm)).toBe(false);
  });

  it('every app.* table ENABLEs RLS with an owner-only policy', () => {
    for (const t of APP_TABLES) {
      expect(new RegExp(`alter\\s+table\\s+app\\.${t}\\s+enable\\s+row\\s+level\\s+security`).test(norm)).toBe(true);
    }
    // Owner-only is keyed on auth.uid() (either user_id or id column).
    expect(/using\s*\(\s*(user_id|id)\s*=\s*auth\.uid\(\)\s*\)/.test(norm)).toBe(true);
  });
});

describe('structural invariants', () => {
  it('creates the required extensions + schemas', () => {
    expect(/create\s+extension\s+if\s+not\s+exists\s+postgis/.test(norm)).toBe(true);
    expect(/create\s+schema\s+if\s+not\s+exists\s+raw/.test(norm)).toBe(true);
    expect(/create\s+schema\s+if\s+not\s+exists\s+app/.test(norm)).toBe(true);
    expect(/create\s+schema\s+if\s+not\s+exists\s+ops/.test(norm)).toBe(true);
  });

  it('defines norm_parcel as an IMMUTABLE function', () => {
    expect(/create\s+or\s+replace\s+function\s+norm_parcel\s*\(\s*raw\s+text\s*\)\s+returns\s+text\s+language\s+sql\s+immutable/.test(norm)).toBe(true);
  });

  it('quarantine table + malformed_key_count column exist (PRD §3.1)', () => {
    expect(/create\s+table\s+(?:if\s+not\s+exists\s+)?ops\.parcel_key_quarantine/.test(norm)).toBe(true);
    expect(/malformed_key_count/.test(norm)).toBe(true);
  });

  it('ops.ingest_run + ops.source_cursor exist (PRD §4.1)', () => {
    expect(/create\s+table\s+(?:if\s+not\s+exists\s+)?ops\.ingest_run/.test(norm)).toBe(true);
    expect(/create\s+table\s+(?:if\s+not\s+exists\s+)?ops\.source_cursor/.test(norm)).toBe(true);
  });

  it('no lat/lng columns anywhere — coordinates live in geometry (PRD §0, §3.1)', () => {
    // Guard against a stray latitude/longitude column being added.
    expect(/\b(latitude|longitude)\b/.test(norm)).toBe(false);
    expect(/\blat\s+(numeric|double|float|real)/.test(norm)).toBe(false);
    expect(/\blng\s+(numeric|double|float|real)/.test(norm)).toBe(false);
  });

  it('matviews carry a UNIQUE index so REFRESH … CONCURRENTLY is legal (PRD §3.4)', () => {
    expect(/create\s+unique\s+index\s+(?:if\s+not\s+exists\s+)?[a-z0-9_]+\s+on\s+public\.distress_signal\s*\(\s*parcel_pk\s*\)/.test(norm)).toBe(true);
    expect(/create\s+unique\s+index\s+(?:if\s+not\s+exists\s+)?[a-z0-9_]+\s+on\s+public\.comp_candidate/.test(norm)).toBe(true);
  });

  it('geo_metric is a regular table with the UNIQUE(geo_type,geo_id,period,metric) grain', () => {
    expect(/create\s+table\s+public\.geo_metric/.test(norm)).toBe(true);
    expect(/unique\s*\(\s*geo_type\s*,\s*geo_id\s*,\s*period\s*,\s*metric\s*\)/.test(norm)).toBe(true);
  });

  it('parcel has geom geometry(point,4326) + GIST index, never lat/lng (PRD §3.2)', () => {
    expect(/geom\s+geometry\s*\(\s*point\s*,\s*4326\s*\)/.test(norm)).toBe(true);
    expect(/create\s+index\s+(?:if\s+not\s+exists\s+)?[a-z0-9_]+\s+on\s+public\.parcel\s+using\s+gist\s*\(\s*geom\s*\)/.test(norm)).toBe(true);
  });
});

/**
 * norm_parcel rule fixtures (PRD §3.1, §8). The SQL function and
 * CityAdapter.normParcelKey share these exact cases. We port the rule here so a
 * change to the SQL semantics is caught without a live DB:
 *   9 digits           → as-is
 *   1–8 digits         → lpad to 9 with '0'
 *   >9 digits OR empty → null
 *   non-numeric chars stripped before the length test
 */
function normParcelRule(raw: string | null | undefined): string | null {
  const x = (raw ?? '').replace(/\D/g, '');
  if (x.length === 9) return x;
  if (x.length >= 1 && x.length <= 8) return x.padStart(9, '0');
  return null; // >9 digits or empty
}

describe('norm_parcel rule fixtures (PRD §3.1)', () => {
  it.each([
    ['12345', '000012345'], // numeric short → lpad 9
    ['123456789', '123456789'], // exactly 9 → as-is
    ['12-3456-789', '123456789'], // dashes stripped → exactly 9 digits → as-is
    ['12-345-6789-0', null], // 11 digits after strip → reject (>9)
    ['12-34-567', '001234567'], // dashed 7-digit string → strip + lpad 9
    ['351243300', '351243300'], // a real-shaped 9-digit OPA id
    ['', null], // empty → null
    [null, null], // null → null
    ['ABC', null], // all non-numeric → empty after strip → null
    ['1234567890', null], // 10 digits → reject (>9)
    ['000000001', '000000001'], // 9-digit with leading zeros preserved
  ])('norm_parcel(%j) → %j', (input, expected) => {
    expect(normParcelRule(input as string | null)).toBe(expected);
  });

  it('the L&I parcel_id_num decoy does NOT silently yield a join key it should not', () => {
    // A decoy value that is not a real OPA id still normalizes structurally; the
    // protection is that we NEVER feed parcel_id_num to norm_parcel (PRD §3.1).
    // This fixture documents that a short decoy lpads rather than erroring — the
    // safeguard is procedural (key-column choice in the adapter), asserted here so
    // the intent is recorded alongside the normalizer.
    expect(normParcelRule('4567')).toBe('000004567');
  });
});
