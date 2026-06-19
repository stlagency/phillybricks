/**
 * Bandbox migration runner (PRD §2, §9 M0).
 *
 * Applies packages/db/migrations/NNNN_*.sql in lexical order over DATABASE_URL,
 * exactly once each, recording applied files in an ops.schema_migration ledger.
 * Idempotent: a re-run skips already-applied migrations. Each migration runs
 * inside its own transaction (except statements Postgres forbids in a tx block —
 * none of the v1 migrations use those), so a failure rolls that file back cleanly.
 *
 * No secrets in source — DATABASE_URL is read from process.env (PRD §0.3, §8).
 *
 * Usage:
 *   DATABASE_URL=postgres://… node --experimental-strip-types src/migrate.ts
 *   (or import { runMigrations } and call it from the ingestion worker.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import postgres, { type Sql } from 'postgres';

/** Default location of the SQL migrations, resolved relative to this file. */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Lexical-order filename pattern: NNNN_name.sql (e.g. 0001_extensions_schemas.sql). */
const MIGRATION_FILE = /^\d{4}_.+\.sql$/;

export interface MigrationFile {
  /** Filename, e.g. '0001_extensions_schemas.sql'. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Raw SQL contents. */
  sql: string;
  /** sha256 of the SQL contents — recorded so drift is detectable. */
  checksum: string;
}

export interface MigrationResult {
  /** Migrations applied during THIS run (already-applied ones are excluded). */
  applied: string[];
  /** Migrations skipped because the ledger already recorded them. */
  skipped: string[];
}

/** Read + sort the migration files from a directory (lexical NNNN_ order). */
export function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const sql = readFileSync(path, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      return { name, path, sql, checksum };
    });
}

/** Ensure the ledger table exists. Lives in ops.* (internal-only, never anon-exposed). */
async function ensureLedger(sql: Sql): Promise<void> {
  await sql.unsafe(`
    create schema if not exists ops;
    create table if not exists ops.schema_migration (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `);
}

/**
 * Apply every not-yet-applied migration in order. Returns which ran vs skipped.
 * Each file is wrapped in a transaction + recorded in the ledger atomically.
 */
export async function runMigrations(sql: Sql, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  await ensureLedger(sql);

  const files = loadMigrations(dir);
  const appliedRows = await sql<{ name: string }[]>`select name from ops.schema_migration`;
  const alreadyApplied = new Set(appliedRows.map((r) => r.name));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file.name)) {
      skipped.push(file.name);
      continue;
    }
    // One transaction per migration: the DDL + the ledger insert commit together.
    await sql.begin(async (tx) => {
      await tx.unsafe(file.sql);
      await tx`insert into ops.schema_migration (name, checksum) values (${file.name}, ${file.checksum})`;
    });
    applied.push(file.name);
  }

  return { applied, skipped };
}

/** Read DATABASE_URL from env or throw — never hardcode a connection string. */
export function databaseUrlFromEnv(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set. Migrations read the connection string from the environment (no secrets in source).');
  }
  return url;
}

/** CLI entrypoint: connect, migrate, report, disconnect. */
export async function main(): Promise<void> {
  const url = databaseUrlFromEnv();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const { applied, skipped } = await runMigrations(sql);
    if (applied.length === 0) {
      console.log(`✅ Database up to date — ${skipped.length} migration(s) already applied.`);
    } else {
      console.log(`✅ Applied ${applied.length} migration(s):`);
      for (const name of applied) console.log(`  • ${name}`);
      if (skipped.length > 0) console.log(`   (skipped ${skipped.length} already-applied)`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Run only when invoked directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('❌ Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
