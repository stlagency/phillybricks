/**
 * ops.ingest_run lifecycle + ops.source_cursor helpers (PRD §4.1).
 *
 * One `ingest_run` row per source per nightly attempt: open it (status running),
 * write per-key join rates + counts, close it (success | partial | failed |
 * skipped). The worker runs as service_role (BYPASSRLS) so these writes succeed
 * against the deny-all ops.* policies.
 *
 * `source_cursor` is the resumable keyset state — committed every N pages so a
 * dead backfill resumes from `last_cartodb_id`.
 *
 * Pure DML over the injected `DbClient`; unit-tested with a fake.
 */
import type { DbClient } from './db.js';

export type IngestStatus = 'running' | 'success' | 'partial' | 'failed' | 'skipped';

/** Open a run row (status='running'); returns its id for subsequent updates. */
export async function openIngestRun(db: DbClient, source: string): Promise<number> {
  const rows = (await db.unsafe(
    `insert into ops.ingest_run (source, status, started_at)
     values ($1, 'running', now())
     returning id`,
    [source],
  )) as readonly { id: number | string }[];
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`failed to open ingest_run for ${source}`);
  return Number(id);
}

export interface CloseIngestRunInput {
  id: number;
  status: IngestStatus;
  rowsIn?: number;
  rowsPromoted?: number;
  joinRates?: Record<string, unknown>;
  error?: string | null;
}

/** Close a run row with final status + stats. `join_rates` is JSONB. */
export async function closeIngestRun(db: DbClient, input: CloseIngestRunInput): Promise<void> {
  await db.unsafe(
    `update ops.ingest_run
        set status        = $2,
            finished_at   = now(),
            rows_in       = coalesce($3, rows_in),
            rows_promoted = coalesce($4, rows_promoted),
            join_rates    = coalesce($5::jsonb, join_rates),
            error         = $6
      where id = $1`,
    [
      input.id,
      input.status,
      input.rowsIn ?? null,
      input.rowsPromoted ?? null,
      input.joinRates ? JSON.stringify(input.joinRates) : null,
      input.error ?? null,
    ],
  );
}

export interface SourceCursorState {
  source: string;
  lastCartodbId: number | null;
  /** OPA stores its S3 Last-Modified here (ISO text); keyset sources leave it null. */
  watermark: string | null;
  rowsCommitted: number;
}

/** Read the resumable cursor for a source (null → start from the beginning). */
export async function readSourceCursor(
  db: DbClient,
  source: string,
): Promise<SourceCursorState | null> {
  const rows = (await db.unsafe(
    `select source, last_cartodb_id, watermark, rows_committed
       from ops.source_cursor where source = $1`,
    [source],
  )) as readonly {
    source: string;
    last_cartodb_id: number | string | null;
    watermark: string | Date | null;
    rows_committed: number | string;
  }[];
  const r = rows[0];
  if (r === undefined) return null;
  return {
    source: r.source,
    lastCartodbId: r.last_cartodb_id === null ? null : Number(r.last_cartodb_id),
    watermark: r.watermark == null ? null : new Date(r.watermark as string | Date).toISOString(),
    rowsCommitted: Number(r.rows_committed),
  };
}

/**
 * Upsert the resumable cursor after committing N pages. `watermark` is optional
 * (the OPA bulk source stores its S3 Last-Modified here instead of a keyset id);
 * a null `watermark` preserves the existing value rather than clearing it.
 */
export async function writeSourceCursor(
  db: DbClient,
  source: string,
  lastCartodbId: number | null,
  rowsCommitted: number,
  runId: number | null,
  watermark: string | null = null,
): Promise<void> {
  await db.unsafe(
    `insert into ops.source_cursor (source, last_cartodb_id, watermark, rows_committed, run_id, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (source) do update
        set last_cartodb_id = excluded.last_cartodb_id,
            watermark       = coalesce(excluded.watermark, ops.source_cursor.watermark),
            rows_committed  = excluded.rows_committed,
            run_id          = excluded.run_id,
            updated_at      = now()`,
    [source, lastCartodbId, watermark, rowsCommitted, runId],
  );
}
