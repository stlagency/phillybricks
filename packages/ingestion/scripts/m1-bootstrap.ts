/**
 * M1 bootstrap (run once, locally, against prod):
 *   1. Load the OPA spine (full CSV) → public.parcel + parcel_change_log baselines.
 *   2. Measure each keyed source's live join rate against the real public.parcel,
 *      on a single sampled page — the numbers to set `expectedJoinRate` from.
 *
 *   DATABASE_URL="$(cat <memory>/database-url.secret)" \
 *     NODE_OPTIONS=--max-old-space-size=4096 \
 *     pnpm --filter @bandbox/ingestion exec tsx scripts/m1-bootstrap.ts [measure-only]
 *
 * Not part of the build (outside tsconfig include). Idempotent: re-running re-upserts.
 */
import { philadelphia } from '@bandbox/core';
import { asDbClient, connectFromEnv } from '../src/db.js';
import { makeCartoFetcher, makeOpaFetcher } from '../src/fetchers.js';
import { makeStepsForSpec } from '../src/steps.js';
import { loadParcelKeyIndex, measureJoinRate } from '../src/joinRate.js';

const measureOnly = process.argv.includes('measure-only');

async function main(): Promise<void> {
  const sql = connectFromEnv();
  const db = asDbClient(sql);
  try {
    const spine = philadelphia.sources.find((s) => s.platform === 's3');
    if (!spine?.mapping) throw new Error('no spine source');

    if (!measureOnly) {
      console.log(`[spine] loading ${spine.name} …`);
      const t0 = Date.now();
      const batch = await makeOpaFetcher()(spine, db);
      console.log(`[spine] fetched ${batch.rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s; promoting…`);
      const steps = makeStepsForSpec(spine);
      const promoted = await steps.promote(db, batch, null);
      console.log(`[spine] promoted ${promoted}; running diff (soft-retire + change-log)…`);
      const t1 = Date.now();
      const diffed = await steps.diff(db, batch);
      console.log(`[spine] diff wrote ${diffed} rows in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
    }

    const parcelIndex = await loadParcelKeyIndex(db);
    const indexSize = (await db.unsafe(`select count(*)::int n from public.parcel where is_active=true`)) as { n: number }[];
    console.log(`\n[measure] public.parcel active rows = ${indexSize[0]?.n ?? '?'}\n`);

    const carto = philadelphia.sources.filter(
      (s) => s.platform === 'carto' && s.expectedJoinRate !== undefined && s.mapping,
    );
    const fetcher = makeCartoFetcher({ maxPages: 1 }); // one page is enough to estimate the rate
    console.log('source                              sample   best_col            best_rate   per-key');
    console.log('─'.repeat(100));
    for (const spec of carto) {
      try {
        const batch = await fetcher(spec, db);
        const m = measureJoinRate(spec.name, batch.rows, spec.keyColumns, philadelphia, parcelIndex);
        const perKey = m.perKey.map((k) => `${k.column}=${k.rate.toFixed(3)}(${k.joinedCount}/${k.normalizedCount})`).join('  ');
        console.log(
          `${spec.name.padEnd(35)} ${String(m.totalRows).padStart(6)}   ${(m.bestColumn ?? 'none').padEnd(18)}  ${m.bestRate.toFixed(4)}     ${perKey}`,
        );
      } catch (err) {
        console.log(`${spec.name.padEnd(35)} ERROR ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
