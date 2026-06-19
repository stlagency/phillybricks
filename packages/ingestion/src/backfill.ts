/**
 * Resumable streaming backfill (PRD M1a) — for one-time historical loads too large
 * to hold in memory (RTT: 5.1M deeds back to 1974).
 *
 * Unlike the nightly pipeline (fetch-all → atomic promote), the backfill STREAMS:
 * page → upsert → advance cursor, committing `ops.source_cursor` every N pages.
 * It is bounded by a wall-clock budget (the CI job's ~6h ceiling) and resumes from
 * the persisted cursor on the next run — a dead backfill never re-does committed
 * work. Upserts are idempotent (ON CONFLICT), so re-running a partially-committed
 * page is safe.
 *
 * No join-rate gate here: the gate is for nightly DELTAS; a backfill's job is to get
 * history in. Integrity is reconciled afterward (count within ±0.5% of source).
 */
import type { SourceSpec } from '@bandbox/core/contracts';
import type { DbClient } from './db.js';
import { buildCartoUrl, iterateCartoPages, type FetchLike } from './adapters/carto.js';
import { upsertMapped } from './loaders/upsert.js';
import { readSourceCursor, writeSourceCursor } from './ingestRun.js';

export interface BackfillOptions {
  /** Injected HTTP transport (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Rows per Carto page. Defaults to the spec's pageSize (or 10k). */
  pageSize?: number;
  /** Persist the cursor + log progress every N pages. Default 5. */
  commitEveryPages?: number;
  /** Wall-clock budget; stop + persist when exceeded (resume next run). Default 6h. */
  maxRuntimeMs?: number;
  /** ops.ingest_run id to stamp on the cursor. */
  runId?: number | null;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
  /** Progress sink. */
  log?: (msg: string) => void;
}

export interface BackfillResult {
  source: string;
  pagesFetched: number;
  rowsPromoted: number;
  rowsSkipped: number;
  lastCursor: number | null;
  /** True when the table drained (reached the end). */
  drained: boolean;
  /** True when we stopped because the runtime budget was hit (resume next run). */
  stoppedForTime: boolean;
}

/**
 * Stream a Carto source from its persisted cursor to completion (or the time
 * budget), upserting each page and committing the cursor every `commitEveryPages`.
 */
export async function backfillSource(
  db: DbClient,
  spec: SourceSpec,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  if (!spec.mapping) throw new Error(`source ${spec.name} has no mapping — cannot backfill`);
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const maxRuntimeMs = opts.maxRuntimeMs ?? 6 * 60 * 60 * 1000;
  const commitEvery = Math.max(1, opts.commitEveryPages ?? 5);
  const runId = opts.runId ?? null;

  const cursorState = await readSourceCursor(db, spec.name);
  let cursor: number | null = cursorState?.lastCartodbId ?? null;
  let rowsCommitted = cursorState?.rowsCommitted ?? 0;

  let pagesFetched = 0;
  let rowsPromoted = 0;
  let rowsSkipped = 0;
  let sincePersist = 0;
  let stoppedForTime = false;

  for await (const page of iterateCartoPages<Record<string, unknown>>({
    endpoint: spec.endpoint,
    table: spec.name,
    cursorColumn: spec.cursorColumn ?? 'cartodb_id',
    pageSize: opts.pageSize ?? spec.pageSize ?? 10_000,
    geometryMode: spec.geometryMode ?? 'none',
    where: spec.windowPredicate,
    startCursor: cursor,
    fetchImpl: opts.fetchImpl,
  })) {
    const res = await upsertMapped(db, spec.mapping, page.rows);
    rowsPromoted += res.promoted;
    rowsSkipped += res.skipped;
    rowsCommitted += res.promoted;
    pagesFetched += 1;
    sincePersist += 1;
    if (page.nextCursor !== null) cursor = page.nextCursor;

    if (sincePersist >= commitEvery) {
      await writeSourceCursor(db, spec.name, cursor, rowsCommitted, runId);
      sincePersist = 0;
      opts.log?.(`[backfill ${spec.name}] pages=${pagesFetched} rows=${rowsPromoted} cursor=${cursor}`);
    }

    if (now() - startedAt >= maxRuntimeMs) {
      stoppedForTime = true;
      break;
    }
  }

  // Final cursor persist (covers the tail since the last commit + a clean drain).
  await writeSourceCursor(db, spec.name, cursor, rowsCommitted, runId);

  return {
    source: spec.name,
    pagesFetched,
    rowsPromoted,
    rowsSkipped,
    lastCursor: cursor,
    drained: !stoppedForTime,
    stoppedForTime,
  };
}

export interface ReconcileResult {
  dbCount: number;
  sourceCount: number;
  deltaRatio: number;
  withinTolerance: boolean;
}

/**
 * Reconcile a backfilled table against its live source count (PRD M1a: ±0.5%).
 * `sourceCount` comes from a Carto `count(*)`; `dbCount` from the canonical table.
 */
export async function reconcileSourceCount(
  db: DbClient,
  spec: SourceSpec,
  opts: { fetchImpl?: FetchLike; tolerance?: number } = {},
): Promise<ReconcileResult> {
  if (!spec.mapping) throw new Error(`source ${spec.name} has no mapping`);
  const tolerance = opts.tolerance ?? 0.005;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const url = buildCartoUrl(spec.endpoint, `SELECT count(*) AS n FROM ${spec.name}`);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`carto count ${spec.name} HTTP ${res.status}`);
  const parsed = JSON.parse(await res.text()) as { rows?: { n: number | string }[] };
  const sourceCount = Number(parsed.rows?.[0]?.n ?? 0);

  const dbRows = (await db.unsafe(`select count(*)::bigint n from ${spec.mapping.targetTable}`)) as {
    n: number | string;
  }[];
  const dbCount = Number(dbRows[0]?.n ?? 0);

  const deltaRatio = sourceCount === 0 ? 0 : Math.abs(dbCount - sourceCount) / sourceCount;
  return { dbCount, sourceCount, deltaRatio, withinTolerance: deltaRatio <= tolerance };
}
