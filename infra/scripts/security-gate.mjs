#!/usr/bin/env node
/**
 * RLS / secrets security gate (PRD §3.6, §8) — ONE OF THE FOUR ADVERSARIAL GATES.
 *
 * Static first pass over packages/db/migrations/*.sql. FAILS if:
 *   1. any `public.<table>` lacks `ENABLE ROW LEVEL SECURITY`;
 *   2. any `public.<table>` lacks a REVOKE of INSERT/UPDATE/DELETE from anon+authenticated;
 *   3. any `public.<table>` lacks a GRANT SELECT to anon (exposed-readable);
 *   4. `app.skiptrace_key` does not REVOKE SELECT from anon+authenticated;
 *   5. any `ops.*` relation is GRANTed to anon/authenticated.
 *
 * The LIVE gate (introspecting pg_catalog after running migrations against an
 * ephemeral PostGIS in CI) is the real enforcement — see infra/scripts/security-gate-live.mjs
 * (added in the M1 verification pass). This static pass guards the source of truth.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIG_DIR = join(ROOT, 'packages/db/migrations');

if (!existsSync(MIG_DIR)) {
  console.log('ℹ️  No migrations directory yet — security gate has nothing to guard. (M0 skeleton.)');
  process.exit(0);
}

const sqlFiles = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const sql = sqlFiles.map((f) => readFileSync(join(MIG_DIR, f), 'utf8')).join('\n').toLowerCase();

if (sqlFiles.length === 0 || !/create\s+table\s+public\./.test(sql)) {
  console.log('ℹ️  No public.* tables defined yet — security gate vacuously passes. (M0 skeleton.)');
  process.exit(0);
}

const norm = sql.replace(/\s+/g, ' ');
const failures = [];

// Collect public.* table names (exclude matviews — they carry no RLS, access is GRANT-only).
const tableNames = new Set();
for (const m of norm.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g)) {
  tableNames.add(m[1]);
}

for (const t of tableNames) {
  const fq = `public.${t}`;
  if (!new RegExp(`alter\\s+table\\s+${fq}\\s+enable\\s+row\\s+level\\s+security`).test(norm)) {
    failures.push(`${fq}: missing ENABLE ROW LEVEL SECURITY`);
  }
  const revoke = new RegExp(`revoke\\s+[^;]*\\b(insert|update|delete)\\b[^;]*on\\s+${fq}\\s+from\\s+[^;]*(anon|authenticated)`);
  if (!revoke.test(norm)) {
    failures.push(`${fq}: missing REVOKE INSERT/UPDATE/DELETE FROM anon,authenticated`);
  }
  const grant = new RegExp(`grant\\s+select\\s+on\\s+${fq}\\s+to\\s+[^;]*anon`);
  if (!grant.test(norm)) {
    failures.push(`${fq}: missing GRANT SELECT TO anon (exposed-readable table)`);
  }
}

// app.skiptrace_key must never be selectable by anon/authenticated.
if (/create\s+table\s+(?:if\s+not\s+exists\s+)?app\.skiptrace_key/.test(norm)) {
  const revokeKey = /revoke\s+[^;]*select[^;]*on\s+app\.skiptrace_key\s+from\s+[^;]*(anon|authenticated)/;
  if (!revokeKey.test(norm)) {
    failures.push('app.skiptrace_key: missing REVOKE SELECT FROM anon,authenticated (encrypted_key must not be selectable)');
  }
}

// ops.* must not be granted to anon/authenticated.
const opsGrant = /grant\s+[^;]*on\s+ops\.[a-z0-9_]+\s+to\s+[^;]*(anon|authenticated)/;
if (opsGrant.test(norm)) {
  failures.push('ops.*: a GRANT to anon/authenticated was found — ops holds raw error text + cursors, never expose it');
}

if (failures.length > 0) {
  console.error('❌ Security gate FAILED (static SQL pass):');
  for (const f of failures) console.error(`  • ${f}`);
  console.error('\nFix the migrations so every exposed relation is RLS-enabled, write-revoked, and correctly granted.');
  process.exit(1);
}

console.log(`✅ Security gate passed (static) — ${tableNames.size} public table(s) RLS-enabled, write-revoked, select-granted; skiptrace_key + ops locked down.`);
