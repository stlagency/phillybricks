/**
 * Server-only Postgres client for the Next API routes (PRD §6 — "Next API routes
 * (auth/logic)"). Reads DATABASE_URL (the Supabase transaction pooler) from the
 * environment; NEVER imported into a client component, so the connection string
 * never reaches the browser. `prepare:false` + `ssl:'require'` are mandatory for
 * the pooler (port 6543). One small pool, reused across warm serverless invocations.
 *
 * Canonical relation names only — no Philly SOURCE literal (portability gate).
 */
import postgres, { type Sql } from 'postgres';

let _sql: Sql | null = null;

/** Lazily-initialized shared client. Throws if DATABASE_URL is unset. */
export function db(): Sql {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set — the API routes read it from the environment (apps/web/.env.local locally; a Vercel env var in prod).',
    );
  }
  _sql = postgres(url, {
    max: 3,
    prepare: false,
    ssl: 'require',
    idle_timeout: 20,
    onnotice: () => {},
  });
  return _sql;
}
