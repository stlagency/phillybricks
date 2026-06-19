/**
 * M3 distress PARITY verifier (PRD §3.4 / §5.3) — the live, on-real-data proof that
 * the SQL composite stored in public.distress_signal equals the TS scoreDistress the
 * deep-dive renders. Samples high/mid/zero-score parcels, rebuilds the raw signals from
 * the matview row, re-scores in TS, and asserts score01/score100 match.
 *
 *   DATABASE_URL="$(cat <memory>/database-url.secret)" \
 *     pnpm --filter @bandbox/ingestion exec tsx scripts/verify-distress-parity.ts
 */
import { scoreDistress, DISTRESS_COMPONENT_KEYS } from '@bandbox/core';
import type { DistressComponentKey } from '@bandbox/core/contracts';
import { asDbClient, connectFromEnv } from '../src/db.js';

/** Columns that arrive as numeric/bigint (postgres.js → string) and must be coerced. */
const NUMERIC_COLS = new Set<DistressComponentKey>([
  'tax_delinquent',
  'open_violations',
  'recent_complaints',
  'below_market_last_sale',
]);

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required.');
  const sql = connectFromEnv();
  const db = asDbClient(sql);
  try {
    const rows = (await db.unsafe(`
      (select * from public.distress_signal where score01 > 0.3 order by score01 desc limit 25)
      union all
      (select * from public.distress_signal where score01 between 0.02 and 0.3 limit 35)
      union all
      (select * from public.distress_signal where score01 = 0 limit 15)
    `)) as readonly Record<string, unknown>[];

    let mismatches = 0;
    for (const r of rows) {
      const signals: Partial<Record<DistressComponentKey, number | boolean | null>> = {};
      for (const key of DISTRESS_COMPONENT_KEYS) {
        const v = r[key];
        signals[key] = NUMERIC_COLS.has(key) ? (v == null ? null : Number(v)) : (v as boolean | null);
      }
      const res = scoreDistress({ parcel_pk: String(r.parcel_pk), signals });
      const coreScore01 = Math.round(res.score01 * 1e6) / 1e6;
      const mvScore01 = Number(r.score01);
      const mvScore100 = Number(r.score100);
      if (Math.abs(coreScore01 - mvScore01) > 1e-6 || res.score100 !== mvScore100) {
        mismatches += 1;
        console.log(
          `MISMATCH ${r.parcel_pk}: mv(${mvScore01}/${mvScore100}) vs core(${coreScore01}/${res.score100})`,
          signals,
        );
      }
    }
    console.log(
      mismatches === 0
        ? `✅ distress parity: ${rows.length} sampled parcels — matview score01/score100 == scoreDistress (0 mismatches).`
        : `❌ distress parity: ${mismatches}/${rows.length} MISMATCH.`,
    );
    if (mismatches > 0) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('verify-distress-parity failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
