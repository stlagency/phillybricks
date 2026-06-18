/**
 * CityAdapter — the portability seam (PRD §2.1).
 *
 * NO Philadelphia literal (table name, URL, document_type) may live outside
 * `packages/core/src/adapters/`. A CI grep gate (infra/scripts/portability-grep.mjs)
 * fails the build on Philly literals found elsewhere. A second city is config +
 * adapters, not a rewrite.
 *
 * This file is a FROZEN CONTRACT: downstream packages (ingestion, db, web) import
 * these types. Extend additively; do not reshape without updating every consumer.
 */
import type { SourceMapping } from './ingest.js';

/** The four map lenses (PRD §7.1, CONCEPT §2). One active at a time. */
export type LensMetric = 'price' | 'momentum' | 'distress' | 'livability';

/** Geographic aggregation units for the multi-resolution scan (PRD §3.4). */
export type GeoType = 'zip' | 'neighborhood' | 'tract';

/** How a source delivers coordinates. No lat/lng anywhere — coords live in geometry. */
export type GeometryMode = 'wkt' | 'geojson' | 'none';

/** Ingestion transport per source (PRD §4.2). */
export type SourcePlatform = 'carto' | 's3' | 'scrape' | 'file';

export type Cadence = 'nightly' | 'weekly' | 'once';

/**
 * A single ingest source. `keyColumns` are CANDIDATE parcel-key columns to
 * normalize (via normParcelKey) and try — the join is empirical (PRD §3.1).
 * `expectedJoinRate` is the per-source gate baseline MEASURED in M1, not a
 * uniform assumption. Spatial sources (crime/311) set it undefined and are
 * exempt from the parcel-join gate.
 */
export interface SourceSpec {
  name: string;
  platform: SourcePlatform;
  endpoint: string;
  /** Candidate parcel-key columns to normalize + try, in priority order. */
  keyColumns: string[];
  /** Keyset-pagination cursor column (e.g. 'cartodb_id'). Stable, unique. */
  cursorColumn?: string;
  /** Delta predicate column for incremental loads — NOT used for page ordering. */
  incrementalColumn?: string;
  /** How coordinates arrive, if any. */
  geometryMode?: GeometryMode;
  cadence: Cadence;
  /**
   * Per-source join-rate gate baseline [0..1], measured in M1. Below this →
   * quarantine + alert (NOT halt). Undefined ⇒ spatial source, parcel-join exempt.
   */
  expectedJoinRate?: number;
  /** Explicit page size, bounded by Carto's ~10 MB client buffer + ~30 s timeout. */
  pageSize?: number;
  /** Target canonical table this source promotes into. */
  targetTable: string;
  /**
   * Declarative raw→canonical column mapping (PRD §4.2). Lives here (the adapter)
   * because it names source literals the portability gate forbids elsewhere; the
   * ingestion engine consumes it generically. Absent ⇒ source is not yet wired
   * (reported `skipped`).
   */
  mapping?: SourceMapping;
  /**
   * Optional Carto WHERE predicate appended to keyset pages (PRD §4.3): the ~10y
   * window for spatial feeds + the 311 noise filter. Names source columns, so it
   * lives here in the adapter. No leading AND.
   */
  windowPredicate?: string;
  /** Optional notes carried into ops logging / docs. */
  notes?: string;
}

/**
 * Document-type vocabularies for transfer-flag derivation (PRD §5.1).
 * Philly values are verified live in Carto. `estateNameRegex` recovers the
 * "estate/quitclaim is not a document_type" correction (CONCEPT §1) — it is
 * DERIVED from grantor/grantee names, not read from a column.
 */
export interface DocumentTypes {
  armsLength: string[];
  distress: string[];
  sheriff: string[];
  estateNameRegex: RegExp;
}

/** A one-time geographic boundary source (PRD §4.2). */
export interface GeoSourceSpec {
  kind: GeoType;
  url: string;
  idField: string;
  nameField?: string;
}

/** Scraper config — honor robots Crawl-delay; assert column order before parse. */
export interface ScraperSpec {
  urls: string[];
  expectedColumns: string[];
  crawlDelaySec: number;
}

export interface CityAdapter {
  /** Stable slug, e.g. 'philadelphia'. */
  city: string;
  sources: SourceSpec[];
  /**
   * Canonical parcel-key normalizer (PRD §3.1). 9 digits → as-is; 1–8 → zero-pad
   * to 9; >9 digits or empty/non-numeric → null (quarantine + count). The SQL
   * `norm_parcel` mirrors this exactly; both are fixture-tested. NEVER derived
   * from L&I `parcel_id_num` (decoy).
   */
  normParcelKey(raw: string | null | undefined): string | null;
  documentTypes: DocumentTypes;
  /** Consideration at/below this is "nominal" (e.g. $1 estate deeds). */
  nominalConsiderationFloor: number;
  geoSources: GeoSourceSpec[];
  scraper?: ScraperSpec;
  /** Per-lens SQL that colors a geo unit from geo_metric (PRD §2.1, §7.1). */
  lensMetricSql: Record<LensMetric, string>;
}
