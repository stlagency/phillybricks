/**
 * @bandbox/db — SQL schema, migration runner, canonical table-name constants,
 * and a generated-types placeholder (PRD §2, §3).
 *
 * The migrations in ./migrations/ are the source of truth for the schema; the
 * RLS/secrets gate (infra/scripts/security-gate.mjs) grades them. This module
 * re-exports the runner and gives the rest of the monorepo stable, typo-proof
 * references to the table names rather than scattering string literals.
 */

export {
  runMigrations,
  loadMigrations,
  databaseUrlFromEnv,
  main as runMigrationsCli,
  MIGRATIONS_DIR,
  type MigrationFile,
  type MigrationResult,
} from './migrate.js';

// ── Canonical table-name constants ───────────────────────────────────────────
// Single source of truth for relation names. Consumers import these instead of
// hand-writing 'public.parcel' etc. (Note: these are GENERIC schema names, not
// Philly-source literals, so they may live outside packages/core/adapters/.)

/** public.* tables that are anon-readable (RLS + GRANT SELECT, PRD §3.2/§3.6). */
export const PUBLIC_TABLES = [
  'parcel',
  'transfer',
  'permit',
  'violation',
  'complaint',
  'case_investigation',
  'distress_inventory',
  'sheriff_listing',
  'crime_incident',
  'service_request',
  'parcel_change_log',
  'delinquency_event',
  'violation_event',
  'tax_delinquency',
  'tax_balance',
  'business_license',
  'geo_metric',
  'geo_boundary',
] as const;
export type PublicTable = (typeof PUBLIC_TABLES)[number];

/** public.* materialized views — no RLS; access is GRANT SELECT only (PRD §3.4). */
export const PUBLIC_MATVIEWS = ['distress_signal', 'comp_candidate'] as const;
export type PublicMatview = (typeof PUBLIC_MATVIEWS)[number];

/** app.* user tables — RLS owner-only (PRD §3.5/§3.6). */
export const APP_TABLES = [
  'profile',
  'subscription',
  'saved_area',
  'saved_lead',
  'alert_subscription',
  'alert_event',
  'skiptrace_key',
  'skiptrace_usage',
] as const;
export type AppTable = (typeof APP_TABLES)[number];

/** ops.* internal tables — never anon-exposed (PRD §3.6). */
export const OPS_TABLES = [
  'ingest_run',
  'source_cursor',
  'parcel_key_quarantine',
  'schema_migration',
] as const;
export type OpsTable = (typeof OPS_TABLES)[number];

/** Schema-qualified helper, e.g. qualify('public', 'parcel') → 'public.parcel'. */
export function qualify(schema: 'public' | 'app' | 'ops' | 'raw', relation: string): string {
  return `${schema}.${relation}`;
}

/**
 * Database types placeholder. The real shape is generated from the live schema in
 * the M1 verification pass (supabase gen types / the live introspection script)
 * and will replace this stub. Kept minimal + additive so importers compile today.
 */
export interface Database {
  public: Record<string, unknown>;
  app: Record<string, unknown>;
  ops: Record<string, unknown>;
  raw: Record<string, unknown>;
}
