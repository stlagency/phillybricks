/**
 * @bandbox/ingestion — the nightly worker + source adapters (PRD §4).
 *
 * Pipeline (one source): normalize → load raw/staging → validate(per-source
 * JOIN-RATE gate) → promote canonical (atomic) → diff→change-log/alert → refresh
 * derived → trigger tile build. The per-source join-rate gate is one of the four
 * correctness gates; it quarantines + alerts below threshold and NEVER halts.
 *
 * Philly source literals live ONLY in @bandbox/core's `philadelphia`
 * adapter; this package imports them, never hard-codes them.
 */

// DB seam.
export {
  connectFromEnv,
  asDbClient,
  type DbClient,
} from './db.js';

// Parcel-key normalization (delegates to the adapter for SQL parity) + quarantine.
export {
  normParcel,
  normParcelFromRow,
  makeQuarantineRow,
  persistQuarantine,
  type QuarantineReason,
  type QuarantineRow,
} from './normParcel.js';

// Per-source JOIN-RATE gate.
export {
  measureJoinRate,
  evaluateGate,
  joinRatesPayload,
  loadParcelKeyIndex,
  type KeyPathRate,
  type JoinRateMeasurement,
  type GateDecision,
  type ParcelKeyIndex,
} from './joinRate.js';

// Ordered pipeline.
export {
  runSourcePipeline,
  type StagedBatch,
  type PipelineHooks,
  type AlertEvent,
  type SourceSteps,
  type PipelineOutcome,
  type RunPipelineDeps,
} from './pipeline.js';

// ops.ingest_run + ops.source_cursor lifecycle.
export {
  openIngestRun,
  closeIngestRun,
  readSourceCursor,
  writeSourceCursor,
  type IngestStatus,
  type CloseIngestRunInput,
  type SourceCursorState,
} from './ingestRun.js';

// Carto keyset-pagination adapter.
export {
  buildKeysetSql,
  buildCartoUrl,
  fetchCartoPage,
  iterateCartoPages,
  type FetchLike,
  type CartoPageOptions,
  type CartoPage,
} from './adapters/carto.js';

// OPA bulk-CSV adapter.
export {
  OPA_EXPECTED_ROWS,
  OPA_ROWCOUNT_TOLERANCE,
  evaluateOpaFreshness,
  evaluateOpaRowCount,
  geomSqlExpr,
  parseOpaCsv,
  streamOpaRows,
  computeSoftRetire,
  fetchOpaHttp,
  type S3Head,
  type OpaHttp,
  type OpaFreshnessInput,
  type OpaFreshnessDecision,
  type RowCountDecision,
  type OpaParseResult,
} from './adapters/opaBulk.js';

// Mapping-driven upsert engine.
export {
  buildMappedUpsert,
  upsertMapped,
  mapRows,
  type BuiltStatement,
  type UpsertResult,
  type UnsafeRunner,
} from './loaders/upsert.js';

// Diff → change-log / event history.
export {
  PARCEL_CHANGE_LOG_FIELDS,
  buildFieldChangeLogSql,
  runParcelChangeLog,
  runDelinquencyEventDiff,
  runViolationEventDiff,
} from './loaders/changeLog.js';

// Source fetchers (Carto keyset + OPA bulk).
export {
  makeCartoFetcher,
  makeOpaFetcher,
  DEFAULT_MAX_PAGES,
  type CartoFetchOptions,
  type OpaFetchOptions,
} from './fetchers.js';

// Per-source steps factory.
export { makeStepsForSpec, softRetireParcels } from './steps.js';

// M3 derived analytics: geo boundary load, point-in-polygon stamping, geo_metric,
// and the end-of-nightly derived finalize (refresh matviews + recompute geo_metric).
export {
  geoBoundaryIsEmpty,
  loadGeoBoundaries,
  loadGeoBoundarySource,
  type LoadBoundaryResult,
} from './loaders/geoBoundary.js';
export {
  stampGeoColumn,
  stampAllGeo,
  STAMP_TABLES,
  type StampResult,
  type StampTable,
} from './loaders/geoStamp.js';
export {
  recomputeGeoMetrics,
  type RecomputeGeoMetricsOptions,
  type RecomputeGeoMetricsResult,
} from './loaders/geoMetric.js';
export {
  finalizeDerived,
  refreshMatview,
  REFRESH_MATVIEWS,
  type FinalizeDerivedOptions,
  type FinalizeDerivedResult,
  type RefreshMatview,
} from './finalize.js';

// Resumable backfill (M1a).
export {
  backfillSource,
  reconcileSourceCount,
  type BackfillOptions,
  type BackfillResult,
  type ReconcileResult,
} from './backfill.js';

// Worker orchestration.
export {
  runWorker,
  buildRegistries,
  consoleHooks,
  main as runWorkerCli,
  type SourceFetcher,
  type WorkerDeps,
  type SourceRunReport,
} from './run.js';
