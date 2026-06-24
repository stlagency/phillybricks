/**
 * Nightly worker entry point (PRD §4.1).
 *
 * Wires the `philadelphia` adapter's sources through the pipeline. Reads
 * DATABASE_URL from the environment (no secrets in source, PRD §0.3). For each
 * source it opens an ops.ingest_run row, fetches + stages the batch, runs the
 * ordered pipeline (normalize → stage → gate → promote → diff → refresh → tiles),
 * and closes the run — moving to the NEXT source even if one source fails or
 * quarantines (gate ≠ halt, PRD §3.1).
 *
 * The OPA spine (platform 's3') takes a DEDICATED path: it DEFINES the parcel
 * universe, so the parcel-join gate is meaningless (it would read 0% on the first
 * load). Its integrity gate is the freshness gate (in the fetcher); it promotes in
 * chunked statements (pooler-safe, no single giant transaction), soft-retires
 * missing accounts (only on a non-empty batch), and accrues parcel_change_log. After
 * the spine loads, the parcel-key index is refreshed so the keyed sources measure
 * their join rates against real parcels.
 */
import { philadelphia } from '@bandbox/core';
import type { SourceSpec } from '@bandbox/core/contracts';
import { asDbClient, connectFromEnv, type DbClient } from './db.js';
import { loadParcelKeyIndex, type ParcelKeyIndex } from './joinRate.js';
import {
  closeIngestRun,
  openIngestRun,
  readSourceCursor,
  writeSourceCursor,
  type IngestStatus,
} from './ingestRun.js';
import { makeCartoFetcher, makeOpaFetcher } from './fetchers.js';
import { makeScrapeFetcher } from './adapters/scrape.js';
import { makeStepsForSpec } from './steps.js';
import { finalizeDerived } from './finalize.js';
import { runAlerts } from './alerts.js';
import { createZeptoMailSender, parseFromAddress } from './email.js';
import { buildParcelTiles, buildBoundaryTiles } from '@bandbox/tiles';
import {
  runSourcePipeline,
  type PipelineHooks,
  type SourceSteps,
  type StagedBatch,
} from './pipeline.js';

/** A source fetcher returns the staged batch for a source (Carto/OPA/scrape). */
export type SourceFetcher = (spec: SourceSpec, db: DbClient) => Promise<StagedBatch>;

export interface WorkerDeps {
  /** Per-source staged-batch fetchers, keyed by source name. */
  fetchers: Record<string, SourceFetcher>;
  /** Per-source promote/diff/refresh steps, keyed by source name. */
  stepsBySource: Record<string, SourceSteps>;
  hooks: PipelineHooks;
}

export interface SourceRunReport {
  source: string;
  status: IngestStatus;
  rowsIn: number;
  rowsPromoted: number;
  error?: string;
}

/** True for the bulk-snapshot spine source (defines parcels; join-gate-exempt). */
function isSpine(spec: SourceSpec): boolean {
  return spec.platform === 's3';
}

/** True for a scraped source (full re-scrape; gated by column-order, not parcel-join). */
function isScrape(spec: SourceSpec): boolean {
  return spec.platform === 'scrape';
}

/**
 * Run a scraped source (sheriff listings). A full idempotent re-scrape: the fetcher
 * has already asserted the column order (its integrity gate) and parsed every row, so
 * we just upsert on the stable `listing_id` (no join-rate gate, no soft-retire, no
 * keyset cursor). Post-promote diff/refresh are no-ops in M1 (sheriff feeds the M3
 * distress_signal matview directly). An empty scrape is a clean no-op.
 */
async function runScrapeSource(
  db: DbClient,
  spec: SourceSpec,
  batch: StagedBatch,
  steps: SourceSteps,
  hooks: PipelineHooks,
  runId: number,
): Promise<SourceRunReport> {
  const rowsIn = batch.rows.length;
  const rowsPromoted = await db.begin((tx) => steps.promote(tx, batch, null));
  if (rowsIn > 0) {
    await steps.diff(db, batch);
    await steps.refreshDerived(db);
    await Promise.resolve(hooks.triggerTileBuild(spec.name));
  }
  await closeIngestRun(db, { id: runId, status: 'success', rowsIn, rowsPromoted });
  return { source: spec.name, status: 'success', rowsIn, rowsPromoted };
}

/**
 * Run the bulk-snapshot spine (OPA → public.parcel). Promotes in chunked statements
 * (no single giant transaction — pooler-safe + idempotent), then — ONLY on a
 * non-empty batch — soft-retires missing accounts and accrues parcel_change_log, and
 * persists the freshness watermark. An empty batch (freshness skip) is a clean no-op.
 */
async function runSpineSource(
  db: DbClient,
  spec: SourceSpec,
  batch: StagedBatch,
  steps: SourceSteps,
  hooks: PipelineHooks,
  runId: number,
): Promise<SourceRunReport> {
  const rowsIn = batch.rows.length;
  const rowsPromoted = await steps.promote(db, batch, null);
  if (rowsIn > 0) {
    await steps.diff(db, batch);
    await steps.refreshDerived(db);
    await Promise.resolve(hooks.triggerTileBuild(spec.name));
    await writeSourceCursor(db, spec.name, null, rowsPromoted, runId, batch.watermark ?? null);
  }
  await closeIngestRun(db, { id: runId, status: 'success', rowsIn, rowsPromoted });
  return { source: spec.name, status: 'success', rowsIn, rowsPromoted };
}

/**
 * Run the nightly worker over every adapter source with a registered fetcher +
 * steps. A source missing a fetcher is reported `skipped` (not an error) so the
 * registry is honest about what's wired. Returns a per-source report.
 */
export async function runWorker(db: DbClient, deps: WorkerDeps): Promise<SourceRunReport[]> {
  let parcelIndex: ParcelKeyIndex = await loadParcelKeyIndex(db);
  const reports: SourceRunReport[] = [];

  for (const spec of philadelphia.sources) {
    const fetcher = deps.fetchers[spec.name];
    const steps = deps.stepsBySource[spec.name];
    if (!fetcher || !steps) {
      reports.push({ source: spec.name, status: 'skipped', rowsIn: 0, rowsPromoted: 0 });
      continue;
    }

    const runId = await openIngestRun(db, spec.name);
    try {
      const batch = await fetcher(spec, db);

      if (isSpine(spec)) {
        const report = await runSpineSource(db, spec, batch, steps, deps.hooks, runId);
        reports.push(report);
        // Refresh the parcel-key index so the keyed sources measure against real parcels.
        if (report.status === 'success' && batch.rows.length > 0) {
          parcelIndex = await loadParcelKeyIndex(db);
        }
        continue;
      }

      if (isScrape(spec)) {
        reports.push(await runScrapeSource(db, spec, batch, steps, deps.hooks, runId));
        continue;
      }

      const outcome = await runSourcePipeline({
        db,
        adapter: philadelphia,
        spec,
        batch,
        parcelIndex,
        steps,
        hooks: deps.hooks,
        ingestRunId: runId,
      });
      const status: IngestStatus = outcome.status === 'promoted' ? 'success' : 'partial';
      await closeIngestRun(db, {
        id: runId,
        status,
        rowsIn: outcome.rowsIn,
        rowsPromoted: outcome.rowsPromoted,
        joinRates:
          outcome.measurement && outcome.decision.kind !== 'exempt_spatial'
            ? { best_column: outcome.measurement.bestColumn, best_rate: outcome.measurement.bestRate }
            : undefined,
      });
      // Advance the keyset cursor ONLY after a successful promote (resumability).
      if (outcome.status === 'promoted' && batch.nextCursor != null) {
        const committed = (await readSourceCursor(db, spec.name))?.rowsCommitted ?? 0;
        await writeSourceCursor(db, spec.name, batch.nextCursor, committed + outcome.rowsPromoted, runId);
      }
      reports.push({
        source: spec.name,
        status,
        rowsIn: outcome.rowsIn,
        rowsPromoted: outcome.rowsPromoted,
      });
    } catch (err) {
      // One source failing NEVER halts the rest of the nightly run (PRD §3.1).
      const message = err instanceof Error ? err.message : String(err);
      await closeIngestRun(db, { id: runId, status: 'failed', error: message }).catch(() => {});
      try {
        await Promise.resolve(
          deps.hooks.alert({ source: spec.name, kind: 'source_error', message }),
        );
      } catch {
        /* alert failure must not abort the run */
      }
      reports.push({ source: spec.name, status: 'failed', rowsIn: 0, rowsPromoted: 0, error: message });
    }
  }

  return reports;
}

/** Default no-op hooks (overridden in production with healthchecks + tile queue). */
export const consoleHooks: PipelineHooks = {
  alert(event) {
    console.warn(`[alert:${event.kind}] ${event.source}: ${event.message}`);
  },
  triggerTileBuild(source) {
    console.log(`[tiles] rebuild requested for ${source}`);
  },
};

/**
 * Build the fetcher + steps registries from the adapter. Every source that carries
 * a `mapping` is wired (spine → OPA bulk fetcher; otherwise → Carto keyset). Sources
 * without a mapping are reported `skipped` by `runWorker`.
 */
export function buildRegistries(maxPages?: number): Pick<WorkerDeps, 'fetchers' | 'stepsBySource'> {
  const fetchers: Record<string, SourceFetcher> = {};
  const stepsBySource: Record<string, SourceSteps> = {};
  const scraper = philadelphia.scraper;
  for (const spec of philadelphia.sources) {
    if (!spec.mapping) continue;
    if (isScrape(spec)) {
      // A scrape source needs its ScraperSpec (pages + expected columns). Without it
      // the source is left unwired and reported `skipped` by runWorker.
      if (!scraper || scraper.sourceName !== spec.name) continue;
      fetchers[spec.name] = makeScrapeFetcher(scraper);
    } else {
      fetchers[spec.name] = isSpine(spec) ? makeOpaFetcher() : makeCartoFetcher({ maxPages });
    }
    stepsBySource[spec.name] = makeStepsForSpec(spec);
  }
  return { fetchers, stepsBySource };
}

/** CLI entrypoint: connect from env, run the worker, report, disconnect. */
export async function main(): Promise<void> {
  // Until a prod DATABASE_URL is configured, the nightly is heartbeat-only (the
  // repo-mutating keep-alive still runs + resets GitHub's 60-day idle timer).
  if (!process.env.DATABASE_URL) {
    console.log(
      'No DATABASE_URL configured — ingestion not wired to a database yet. ' +
        'Nightly is heartbeat-only (keep-alive). Set the DATABASE_URL secret to begin accruing history.',
    );
    return;
  }
  const maxPages = process.env.NIGHTLY_MAX_PAGES ? Number(process.env.NIGHTLY_MAX_PAGES) : undefined;
  const sql = connectFromEnv();
  const db = asDbClient(sql);
  try {
    const reports = await runWorker(db, { ...buildRegistries(maxPages), hooks: consoleHooks });
    const promoted = reports.filter((r) => r.status === 'success').length;
    const skipped = reports.filter((r) => r.status === 'skipped').length;
    const partial = reports.filter((r) => r.status === 'partial').length;
    const failed = reports.filter((r) => r.status === 'failed').length;
    const rows = reports.reduce((n, r) => n + r.rowsPromoted, 0);
    console.log(
      `Nightly run complete: ${promoted} ok, ${partial} partial, ${skipped} skipped, ${failed} failed; ${rows} rows promoted.`,
    );
    for (const r of reports) {
      console.log(`  ${r.source}: ${r.status} (in=${r.rowsIn}, promoted=${r.rowsPromoted})${r.error ? ` — ${r.error}` : ''}`);
    }

    // Derived finalize runs ONCE, after every source promoted (PRD §4.1 invariant):
    // geo-stamp → refresh comp_candidate + distress_signal (CONCURRENTLY) → geo_metric.
    // A finalize failure must NOT fail the whole nightly (history already accrued).
    try {
      const fin = await finalizeDerived(db, { log: (m) => console.log(`  ${m}`) });
      console.log(
        `Derived finalize complete: refresh ${fin.refreshes.comp_candidate}/${fin.refreshes.distress_signal}, ` +
          `geo_metric ${fin.geoMetric.classAStatements + fin.geoMetric.classBStatements} statements.`,
      );
    } catch (err) {
      console.error(`Derived finalize FAILED (history is safe; will retry next run): ${err instanceof Error ? err.message : err}`);
    }

    // Tile rebuild (PMTiles → Supabase Storage), the LAST step of the nightly
    // (PRD §6 "single object rebuilt nightly"). Opt-in — only when the storage env
    // is configured, so a local DB-only nightly skips cleanly — and NON-FATAL: a
    // tile failure (incl. a missing tippecanoe) must never fail the nightly; the
    // map keeps serving the prior tiles and the irreplaceable change-log already
    // accrued. Each builder self-connects (own max:1 client) so the heavy 583K-row
    // cursor never contends with the worker's pooled connection.
    if (process.env.SUPABASE_S3_ACCESS_KEY_ID) {
      try {
        const p = await buildParcelTiles({ log: (m) => console.log(`  ${m}`) });
        const b = await buildBoundaryTiles({ log: (m) => console.log(`  ${m}`) });
        const bn = b.layers.reduce((n, l) => n + l.featureCount, 0);
        console.log(
          `Tile rebuild complete: parcels ${p.featureCount.toLocaleString()} features` +
            `${p.upload ? ` → ${p.upload.key}` : ''}; boundaries ${b.layers.length} layers (${bn} features).`,
        );
      } catch (err) {
        console.error(
          `Tile rebuild FAILED (non-fatal; map serves the prior tiles): ${err instanceof Error ? err.message : err}`,
        );
      }
    } else {
      console.log('Tile rebuild skipped (SUPABASE_S3_* not configured).');
    }

    // Alert digests (M7, PRD §3.5/§7), AFTER finalizeDerived so distress_signal is
    // fresh for new_matching_lead. The in-app feed is always written; email is
    // opt-in on ZEPTOMAIL_TOKEN (a verified bandbox.pro sender). NON-FATAL — an
    // alert failure must never fail the nightly (history already accrued). Every
    // ZeptoMail send is open+click-tracked by construction (createZeptoMailSender).
    try {
      const token = process.env.ZEPTOMAIL_TOKEN;
      const from = parseFromAddress(process.env.ZEPTOMAIL_FROM ?? 'Bandbox <alerts@bandbox.pro>');
      const sender = token ? createZeptoMailSender({ token, from }) : null;
      const baseUrl = process.env.PUBLIC_BASE_URL ?? 'https://www.bandbox.pro';
      const rep = await runAlerts(db, {
        send: sender,
        baseUrl,
        entitledOnly: process.env.BILLING_ENABLED === 'true',
        log: (m) => console.log(`  ${m}`),
      });
      console.log(
        `Alerts complete: ${rep.subscriptionsProcessed} subscription(s), ` +
          `${rep.eventsInserted} feed event(s), ${rep.emailsSent} email(s)` +
          `${sender ? '' : ' (email disabled — ZEPTOMAIL_TOKEN unset)'}.`,
      );
    } catch (err) {
      console.error(
        `Alerts FAILED (non-fatal; feed/email retried next run): ${err instanceof Error ? err.message : err}`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Nightly worker failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
