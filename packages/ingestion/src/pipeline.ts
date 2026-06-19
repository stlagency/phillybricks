/**
 * Nightly worker pipeline (PRD §4.1). The ordered steps for ONE source:
 *
 *   normalize
 *     → load raw/staging
 *     → validate (per-source JOIN-RATE gate)
 *     → promote canonical (ATOMIC)
 *     → diff → change-log / alert
 *     → refresh derived
 *     → trigger tile build
 *
 * INVARIANT (PRD §4.1): diff/change-log and derived-refresh run ONLY after a
 * source's FULL batch is promoted — never against a partial/un-promoted load.
 * This module enforces that ordering structurally: the post-promote steps are
 * unreachable unless `promote` committed.
 *
 * Gate ≠ halt (PRD §3.1): a below-threshold batch quarantines + alerts and the
 * run continues to the next source. Only an UNEXPECTED error (network, SQL)
 * aborts THIS source — and even then the orchestrator (`run.ts`) moves on.
 *
 * Everything here is dependency-injected (the DB client, the staged rows, the
 * parcel-key index, the alert + tile hooks) so the whole pipeline is unit-tested
 * without a live database or network.
 */
import type { CityAdapter, SourceSpec } from '@bandbox/core/contracts';
import {
  evaluateGate,
  joinRatesPayload,
  measureJoinRate,
  type GateDecision,
  type JoinRateMeasurement,
  type ParcelKeyIndex,
} from './joinRate.js';
import {
  makeQuarantineRow,
  normParcelFromRow,
  persistQuarantine,
  type QuarantineRow,
} from './normParcel.js';
import type { DbClient } from './db.js';

/** A staged source batch: raw rows already fetched + landed in `raw`/staging. */
export interface StagedBatch {
  source: string;
  rows: Record<string, unknown>[];
  /**
   * For spatial sources: the count of rows with a non-null, in-city geometry.
   * The gate validates THIS (not a parcel join) for `expectedJoinRate===undefined`
   * sources. Undefined for non-spatial sources.
   */
  geomValidCount?: number;
  /**
   * Keyset high-water (max cartodb_id) in this batch — the orchestrator advances
   * `ops.source_cursor.last_cartodb_id` to this ONLY after a successful promote, so
   * a crash re-fetches the un-promoted delta (PRD §4.1 resumability).
   */
  nextCursor?: number | null;
  /**
   * OPA bulk only: the S3 object's Last-Modified (ISO). Persisted to the cursor
   * watermark after a successful promote so the next run's freshness gate compares
   * against it.
   */
  watermark?: string | null;
}

/** Side-effect hooks (alerting, tiles) injected so the pipeline stays pure-ish. */
export interface PipelineHooks {
  /** Fire an operational alert (healthchecks / webhook). NEVER throws upward. */
  alert(event: AlertEvent): Promise<void> | void;
  /** Enqueue a tile rebuild after derived refresh. */
  triggerTileBuild(source: string): Promise<void> | void;
}

export interface AlertEvent {
  source: string;
  kind: 'gate_quarantine' | 'spatial_geom_low' | 'source_error';
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Per-source step callbacks the orchestrator supplies. Keeping the actual SQL
 * out of the pipeline keeps it source-agnostic (Carto vs OPA differ only here)
 * and unit-testable. Each returns the count it affected.
 */
export interface SourceSteps {
  /** Upsert the validated batch into the canonical target table, inside `tx`. */
  promote(tx: DbClient, batch: StagedBatch, keyColumn: string | null): Promise<number>;
  /** Diff promoted rows → change-log / event tables. Runs AFTER promote commits. */
  diff(db: DbClient, batch: StagedBatch): Promise<number>;
  /** Refresh the derived matviews / geo_metric touched by this source. */
  refreshDerived(db: DbClient): Promise<void>;
}

export type PipelineOutcome =
  | {
      status: 'promoted';
      source: string;
      rowsIn: number;
      rowsPromoted: number;
      decision: GateDecision;
      measurement: JoinRateMeasurement | null;
      quarantined: number;
    }
  | {
      status: 'quarantined';
      source: string;
      rowsIn: number;
      rowsPromoted: 0;
      decision: GateDecision;
      measurement: JoinRateMeasurement | null;
      quarantined: number;
    };

export interface RunPipelineDeps {
  db: DbClient;
  adapter: CityAdapter;
  spec: SourceSpec;
  batch: StagedBatch;
  parcelIndex: ParcelKeyIndex;
  steps: SourceSteps;
  hooks: PipelineHooks;
  /** ops.ingest_run.id for this attempt (null in tests that don't log). */
  ingestRunId: number | null;
  /**
   * Spatial geom-valid floor [0..1]. Below → alert (still promote — spatial data
   * is best-effort). Default 0.95.
   */
  spatialGeomFloor?: number;
}

/**
 * Run the full ordered pipeline for ONE source. Returns the outcome; the caller
 * writes run stats to ops.ingest_run (we return the payload it needs).
 */
export async function runSourcePipeline(deps: RunPipelineDeps): Promise<PipelineOutcome> {
  const { db, adapter, spec, batch, parcelIndex, steps, hooks, ingestRunId } = deps;
  const rowsIn = batch.rows.length;

  // ── 0. empty batch → clean no-op (PRD §4.2: "zero new rows ≠ failure") ───────
  // A drained incremental source (cursor past the last row) or a source with a
  // legitimate ~7-week lag fetches 0 rows. Measuring a 0-row join rate yields 0,
  // which would FALSELY quarantine; short-circuit to a successful no-op instead so
  // steady-state nightlies stay green.
  if (rowsIn === 0) {
    return {
      status: 'promoted',
      source: spec.name,
      rowsIn: 0,
      rowsPromoted: 0,
      decision:
        spec.expectedJoinRate === undefined
          ? { kind: 'exempt_spatial' }
          : { kind: 'pass', bestColumn: null, bestRate: 0, threshold: spec.expectedJoinRate },
      measurement: null,
      quarantined: 0,
    };
  }

  // ── 1. normalize + collect malformed-key quarantine (non-spatial only) ──────
  const isSpatial = spec.expectedJoinRate === undefined;
  const quarantine: QuarantineRow[] = [];
  if (!isSpatial && spec.keyColumns.length > 0) {
    for (const row of batch.rows) {
      const hit = normParcelFromRow(row, spec.keyColumns, adapter);
      if (hit === null) {
        // Every candidate column rejected → malformed. Quarantine the first
        // candidate's raw value for audit (or '' when absent).
        const firstCol = spec.keyColumns[0]!;
        quarantine.push(makeQuarantineRow(String(row[firstCol] ?? ''), spec.name, 'malformed_key'));
      }
    }
  }

  // ── 2. validate: per-source gate (or spatial geom check) ────────────────────
  let measurement: JoinRateMeasurement | null = null;
  let decision: GateDecision;
  if (isSpatial) {
    decision = { kind: 'exempt_spatial' };
    const floor = deps.spatialGeomFloor ?? 0.95;
    const validRatio = rowsIn === 0 ? 1 : (batch.geomValidCount ?? rowsIn) / rowsIn;
    if (validRatio < floor) {
      await safeAlert(hooks, {
        source: spec.name,
        kind: 'spatial_geom_low',
        message: `geom-valid ratio ${validRatio.toFixed(4)} < floor ${floor}`,
        detail: { rowsIn, geomValidCount: batch.geomValidCount ?? null },
      });
    }
  } else {
    measurement = measureJoinRate(spec.name, batch.rows, spec.keyColumns, adapter, parcelIndex);
    decision = evaluateGate(spec, measurement);
  }

  // Persist quarantine (audit) regardless of decision — never halts.
  if (quarantine.length > 0) {
    await persistQuarantine(db, quarantine, ingestRunId);
  }

  // ── Gate FAIL → quarantine the batch + alert, do NOT promote, do NOT diff ────
  if (decision.kind === 'quarantine') {
    await safeAlert(hooks, {
      source: spec.name,
      kind: 'gate_quarantine',
      message:
        `join rate ${decision.bestRate.toFixed(4)} < threshold ${decision.threshold} ` +
        `(best key: ${decision.bestColumn ?? 'none'}) — batch quarantined, run continues`,
      detail: measurement ? joinRatesPayload(measurement, decision) : undefined,
    });
    return {
      status: 'quarantined',
      source: spec.name,
      rowsIn,
      rowsPromoted: 0,
      decision,
      measurement,
      quarantined: quarantine.length,
    };
  }

  // ── 3. promote canonical (ATOMIC) ───────────────────────────────────────────
  // The whole batch promotes inside one transaction; the post-promote steps are
  // unreachable until this commits (enforces the §4.1 invariant structurally).
  const keyColumn = measurement?.bestColumn ?? null;
  const rowsPromoted = await db.begin((tx) => steps.promote(tx, batch, keyColumn));

  // ── 4. diff → change-log / alert  (ONLY after full-batch promote) ───────────
  await steps.diff(db, batch);

  // ── 5. refresh derived  (ONLY after promote) ────────────────────────────────
  await steps.refreshDerived(db);

  // ── 6. trigger tile build ───────────────────────────────────────────────────
  await Promise.resolve(hooks.triggerTileBuild(spec.name));

  return {
    status: 'promoted',
    source: spec.name,
    rowsIn,
    rowsPromoted,
    decision,
    measurement,
    quarantined: quarantine.length,
  };
}

/** Alerts must never throw upward and break the run — swallow + best-effort. */
async function safeAlert(hooks: PipelineHooks, event: AlertEvent): Promise<void> {
  try {
    await Promise.resolve(hooks.alert(event));
  } catch {
    // An alert-channel failure must not abort ingestion.
  }
}
