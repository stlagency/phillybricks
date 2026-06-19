#!/usr/bin/env node
/**
 * LIVE security gate (PRD §3.6, §8) — THE REAL ENFORCEMENT of the RLS/grant matrix.
 *
 * The static gate (infra/scripts/security-gate.mjs) greps the migration SQL as a
 * fast first pass. THIS gate is the source of truth: it runs the actual migrations
 * against an ephemeral PostGIS instance (CI service container) and then introspects
 * pg_catalog to prove what the database *actually* grants, not what the SQL appears
 * to say. Privilege escalation through GRANTs the static regex can't see (role
 * inheritance, default privileges, column grants, a forgotten GRANT in a later
 * migration) is caught here and only here.
 *
 * It FAILS (exit 1) if ANY of the following hold:
 *   1. anon or authenticated hold INSERT/UPDATE/DELETE on any public.* table.
 *   2. anon or authenticated can SELECT app.skiptrace_key (the encrypted_key column
 *      or the table) — the BYO skip-trace key must never be readable.
 *   3. anon or authenticated can SELECT/INSERT/UPDATE/DELETE on any ops.* relation
 *      (raw error text + cursors + quarantine are internal-only).
 *   4. Any anon-EXPOSED public.* relation lacks RLS, OR lacks a SELECT grant to anon
 *      (a relation that is reachable but neither RLS-protected nor intentionally
 *      granted is a misconfiguration — fail loud).
 *
 * Connection: DATABASE_URL (a localhost CI Postgres). Uses the installed `postgres`
 * client. Because this repo uses pnpm with a non-hoisted store, `postgres` is not
 * resolvable as a bare specifier from infra/scripts/; we anchor resolution at the
 * @bandbox/db package (which declares it as a direct dependency) via
 * createRequire. This keeps the script dependency-free of its own package.json.
 *
 * Usage (from repo root, after migrations have been applied):
 *   DATABASE_URL=postgres://...@localhost:5432/postgres node infra/scripts/security-gate-live.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = process.cwd();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ security-gate-live: DATABASE_URL is required (the ephemeral CI Postgres).');
  process.exit(2);
}

// Roles whose privileges are public-facing. Supabase exposes the DB to the world
// through PostgREST as `anon` and `authenticated`; everything they can reach is
// effectively internet-reachable.
const EXPOSED_ROLES = ['anon', 'authenticated'];

// PostGIS ships these in `public`, owned by the extension/superuser (supabase_admin
// on Supabase). They carry broad default grants we cannot revoke as the migration
// role and are extension plumbing, not application data: geometry_columns /
// geography_columns are read-only views; spatial_ref_sys is public EPSG reference
// data. The gate scopes to OUR relations and excludes these (matches how Supabase's
// own linter treats them).
const POSTGIS_SYS = ['spatial_ref_sys', 'geometry_columns', 'geography_columns'];

// Resolve the installed `postgres` client without relying on hoisting.
const require = createRequire(pathToFileURL(join(ROOT, 'packages/db/package.json')));
let postgres;
try {
  const mod = await import(pathToFileURL(require.resolve('postgres')).href);
  postgres = mod.default ?? mod;
} catch (err) {
  console.error('❌ security-gate-live: could not load the `postgres` client.');
  console.error(`   ${err?.message ?? err}`);
  console.error('   Ensure dependencies are installed (pnpm install --frozen-lockfile).');
  process.exit(2);
}

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 5, onnotice: () => {} });

const failures = [];

try {
  // ---------------------------------------------------------------------------
  // 1. anon/authenticated must NOT hold write privileges on any public.* table.
  //    information_schema.role_table_grants resolves effective grants including
  //    those inherited through role membership — exactly what we want.
  // ---------------------------------------------------------------------------
  const publicWrites = await sql`
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ${sql(EXPOSED_ROLES)}
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES')
      and table_name not in ${sql(POSTGIS_SYS)}
    order by table_name, grantee, privilege_type
  `;
  for (const r of publicWrites) {
    failures.push(
      `WRITE LEAK: ${r.grantee} holds ${r.privilege_type} on public.${r.table_name} (anon/authenticated must be SELECT-only).`,
    );
  }

  // ---------------------------------------------------------------------------
  // 2. anon/authenticated must NOT be able to SELECT app.skiptrace_key
  //    (table-level or any column-level grant — the encrypted_key in particular).
  // ---------------------------------------------------------------------------
  const skiptraceTableSelect = await sql`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'app'
      and table_name = 'skiptrace_key'
      and grantee in ${sql(EXPOSED_ROLES)}
      and privilege_type = 'SELECT'
  `;
  for (const r of skiptraceTableSelect) {
    failures.push(
      `SKIPTRACE LEAK: ${r.grantee} can SELECT app.skiptrace_key (BYO vendor key must never be selectable).`,
    );
  }
  const skiptraceColSelect = await sql`
    select grantee, column_name
    from information_schema.role_column_grants
    where table_schema = 'app'
      and table_name = 'skiptrace_key'
      and grantee in ${sql(EXPOSED_ROLES)}
      and privilege_type = 'SELECT'
  `;
  for (const r of skiptraceColSelect) {
    failures.push(
      `SKIPTRACE LEAK: ${r.grantee} can SELECT app.skiptrace_key.${r.column_name} (column-level grant).`,
    );
  }

  // ---------------------------------------------------------------------------
  // 3. anon/authenticated must NOT hold ANY privilege on ops.* relations
  //    (raw error text, cursors, quarantine — internal-only).
  // ---------------------------------------------------------------------------
  const opsGrants = await sql`
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'ops'
      and grantee in ${sql(EXPOSED_ROLES)}
    order by table_name, grantee, privilege_type
  `;
  for (const r of opsGrants) {
    failures.push(
      `OPS LEAK: ${r.grantee} holds ${r.privilege_type} on ops.${r.table_name} (ops.* is internal-only).`,
    );
  }
  // Schema-level USAGE on ops for an exposed role is itself a leak signal.
  const opsSchemaUsage = await sql`
    select grantee, privilege_type
    from information_schema.role_usage_grants
    where object_schema = 'ops'
      and grantee in ${sql(EXPOSED_ROLES)}
  `;
  for (const r of opsSchemaUsage) {
    failures.push(
      `OPS LEAK: ${r.grantee} holds ${r.privilege_type} USAGE on schema ops (must be revoked).`,
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Every public.* relation that an exposed role can SELECT must also have RLS
  //    enabled. A plain TABLE that is anon-SELECTable without RLS is a misconfig:
  //    RLS is the backstop even though the policy is `using(true)`. Matviews and
  //    foreign tables don't carry RLS — access is GRANT-only — so they're exempt
  //    from the RLS requirement but still must not be writable (covered by #1).
  //    Conversely, every base TABLE in public that has RLS must have a SELECT grant
  //    to anon (otherwise it's exposed-by-schema but silently unreadable — a sign a
  //    grant was forgotten).
  // ---------------------------------------------------------------------------
  const publicSelectable = await sql`
    select distinct g.table_name, c.relkind, c.relrowsecurity
    from information_schema.role_table_grants g
    join pg_catalog.pg_class c on c.relname = g.table_name
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where g.table_schema = 'public'
      and g.grantee in ${sql(EXPOSED_ROLES)}
      and g.privilege_type = 'SELECT'
      and g.table_name not in ${sql(POSTGIS_SYS)}
    order by g.table_name
  `;
  for (const r of publicSelectable) {
    // relkind: r = ordinary table, m = matview, v = view, p = partitioned table, f = foreign.
    const isBaseTable = r.relkind === 'r' || r.relkind === 'p';
    if (isBaseTable && r.relrowsecurity !== true) {
      failures.push(
        `RLS MISSING: public.${r.table_name} is SELECTable by an exposed role but has no ROW LEVEL SECURITY.`,
      );
    }
  }

  // Every public base TABLE with RLS enabled must grant SELECT to anon (the
  // canonical/derived data is intentionally public — a missing grant is a bug).
  const publicRlsTables = await sql`
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity = true
    order by c.relname
  `;
  for (const r of publicRlsTables) {
    const granted = await sql`
      select 1
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = ${r.table_name}
        and grantee = 'anon'
        and privilege_type = 'SELECT'
      limit 1
    `;
    if (granted.length === 0) {
      failures.push(
        `GRANT MISSING: public.${r.table_name} has RLS but no GRANT SELECT to anon (exposed-readable data must be granted).`,
      );
    }
  }
} catch (err) {
  console.error('❌ security-gate-live: introspection query failed.');
  console.error(`   ${err?.message ?? err}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(2);
}

await sql.end({ timeout: 5 }).catch(() => {});

if (failures.length > 0) {
  console.error('❌ LIVE security gate FAILED — the database grants violate PRD §3.6:');
  for (const f of failures) console.error(`  • ${f}`);
  console.error(
    '\nFix the migrations (RLS + REVOKE write + GRANT SELECT) so pg_catalog matches the intended matrix.',
  );
  process.exit(1);
}

console.log(
  '✅ LIVE security gate passed — pg_catalog confirms: no anon/authenticated writes on public.*, ' +
    'no skiptrace_key select, ops.* locked down, every exposed public table RLS-protected + granted.',
);
