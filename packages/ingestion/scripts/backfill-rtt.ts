/**
 * M1a: RTT backfill to 1974 (resumable). Streams rtt_summary by keyset, upserting
 * into public.transfer with derived transfer flags, committing the cursor every few
 * pages. Bounded by RTT_BACKFILL_HOURS (default 6h) so a CI run fits the job ceiling
 * and resumes next run. Reconciles the loaded count against the live source (±0.5%).
 *
 *   DATABASE_URL="$(cat <memory>/database-url.secret)" \
 *     pnpm --filter @bandbox/ingestion exec tsx scripts/backfill-rtt.ts
 *
 * Idempotent + resumable: safe to re-run until `drained` + reconciled.
 */
import { philadelphia } from '@bandbox/core';
import { asDbClient, connectFromEnv } from '../src/db.js';
import { backfillSource, reconcileSourceCount } from '../src/backfill.js';
import { closeIngestRun, openIngestRun } from '../src/ingestRun.js';

async function main(): Promise<void> {
  const spec = philadelphia.sources.find((s) => s.name === 'rtt_summary');
  if (!spec) throw new Error('rtt_summary source not found');

  const hours = process.env.RTT_BACKFILL_HOURS ? Number(process.env.RTT_BACKFILL_HOURS) : 6;
  const sql = connectFromEnv();
  const db = asDbClient(sql);
  const runId = await openIngestRun(db, spec.name);
  try {
    const t0 = Date.now();
    const res = await backfillSource(db, spec, {
      runId,
      commitEveryPages: 5,
      maxRuntimeMs: hours * 60 * 60 * 1000,
      log: (m) => console.log(m),
    });
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(
      `\n[backfill] ${res.source}: pages=${res.pagesFetched} promoted=${res.rowsPromoted} ` +
        `skipped=${res.rowsSkipped} cursor=${res.lastCursor} drained=${res.drained} stoppedForTime=${res.stoppedForTime} (${mins}m)`,
    );
    await closeIngestRun(db, {
      id: runId,
      status: res.drained ? 'success' : 'partial',
      rowsIn: res.rowsPromoted + res.rowsSkipped,
      rowsPromoted: res.rowsPromoted,
    });

    if (res.drained) {
      const rec = await reconcileSourceCount(db, spec);
      console.log(
        `[reconcile] ${spec.name}: db=${rec.dbCount} source=${rec.sourceCount} ` +
          `delta=${(rec.deltaRatio * 100).toFixed(3)}% withinTolerance(±0.5%)=${rec.withinTolerance}`,
      );
      if (!rec.withinTolerance) process.exitCode = 2;
    } else {
      console.log('[backfill] time budget hit — re-run to resume from the committed cursor.');
    }
  } catch (err) {
    await closeIngestRun(db, {
      id: runId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
