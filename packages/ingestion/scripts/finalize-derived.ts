/**
 * M3 derived-finalize runner / live populator (PRD §3.4, §9 DoD).
 *
 * Runs the REAL production finalize (`finalizeDerived`): lazy-load geo_boundary,
 * point-in-polygon stamp parcel/crime/311, refresh comp_candidate + distress_signal,
 * recompute geo_metric. Idempotent.
 *
 *   # first M3 populate — full geo_metric backfill + force a full geo re-stamp:
 *   DATABASE_URL="$(cat <memory>/database-url.secret)" NODE_OPTIONS=--max-old-space-size=4096 \
 *     pnpm --filter @bandbox/ingestion exec tsx scripts/finalize-derived.ts backfill
 *
 *   # nightly-equivalent — incremental stamp + trailing-3mo class-(a) recompute:
 *   DATABASE_URL="$(cat <memory>/database-url.secret)" \
 *     pnpm --filter @bandbox/ingestion exec tsx scripts/finalize-derived.ts
 *
 * Not part of the build (outside tsconfig include).
 */
import { asDbClient, connectFromEnv } from '../src/db.js';
import { finalizeDerived } from '../src/finalize.js';

const backfill = process.argv.includes('backfill');

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for finalize-derived.');
  const sql = connectFromEnv();
  const db = asDbClient(sql);
  const t0 = Date.now();
  try {
    const result = await finalizeDerived(db, {
      backfill,
      forceStamp: backfill,
      log: (m) => console.log(`  ${m}`),
    });
    const geoMetricRows = (await db.unsafe(`select count(*)::int as n from public.geo_metric`)) as readonly { n: number }[];
    console.log(
      `✅ finalize-derived (${backfill ? 'backfill' : 'incremental'}) done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
        `refresh ${result.refreshes.comp_candidate}/${result.refreshes.distress_signal}, ` +
        `geo_metric rows=${geoMetricRows[0]?.n ?? 0}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('❌ finalize-derived failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
