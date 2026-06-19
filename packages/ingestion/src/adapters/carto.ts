/**
 * Carto SQL-API adapter (PRD §4.1, §4.2).
 *
 * Carto is public + unauthenticated (NO key). We page by KEYSET on a stable,
 * unique cursor column (`cartodb_id`):
 *
 *   SELECT … FROM <table>
 *   WHERE cartodb_id > $cursor
 *   ORDER BY cartodb_id
 *   LIMIT <page>
 *
 * Keyset (not OFFSET) so a 5.1M-row backfill is resumable from
 * `ops.source_cursor.last_cartodb_id` and immune to rows shifting under us.
 * `recording_date` is explicitly NOT a page-order key — it is non-unique and
 * deeds arrive back-dated (PRD §4.2).
 *
 * Page size is bounded by Carto's ~10 MB client buffer + ~30 s request timeout
 * (PRD §4.1). Geometry, when requested, comes as GeoJSON (`format=geojson`) or as
 * ST_X/ST_Y columns — never as lat/lng (coords live in geometry, PRD §0/§3.1).
 *
 * No I/O assumptions leak: the HTTP transport is injected (`fetchImpl`) so unit
 * tests run offline and a CARTO_LIVE smoke test can pass the real `fetch`.
 */
import type { GeometryMode } from '@bandbox/core/contracts';

/** Minimal fetch shape we rely on (Node 18+ global `fetch` satisfies it). */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export interface CartoPageOptions {
  /** Carto SQL API base URL (comes from the adapter's SourceSpec.endpoint). */
  endpoint: string;
  /** Source table name (from the adapter's SourceSpec). */
  table: string;
  /** Keyset cursor column. Stable + unique. Default 'cartodb_id'. */
  cursorColumn?: string;
  /** Strictly-greater cursor watermark; null/undefined starts from the beginning. */
  cursor?: number | null;
  /** Rows per page, bounded by the ~10 MB buffer / ~30 s timeout. */
  pageSize: number;
  /** Columns to select. Default '*'. Geometry handled by `geometryMode`. */
  columns?: string[];
  /** How to materialize geometry into the SELECT. Default 'none'. */
  geometryMode?: GeometryMode;
  /** Optional extra WHERE predicate (e.g. windowing, noise filters). No leading AND. */
  where?: string;
  /** Per-request timeout in ms. Default 30_000 (Carto's ~30 s ceiling). */
  timeoutMs?: number;
  /** Injected transport. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

export interface CartoPage<Row = Record<string, unknown>> {
  rows: Row[];
  /** Highest cursor value in this page (feed as next `cursor`). Null when empty. */
  nextCursor: number | null;
  /** True when a full page came back — there may be more. */
  hasMore: boolean;
}

/**
 * Build the keyset SQL for one page. Exported for tests + transparency (every
 * query the worker issues is inspectable).
 */
export function buildKeysetSql(opts: CartoPageOptions): string {
  const cursorColumn = opts.cursorColumn ?? 'cartodb_id';
  const cols = selectColumns(opts);
  const predicates: string[] = [];
  if (opts.cursor != null) predicates.push(`${cursorColumn} > ${Number(opts.cursor)}`);
  if (opts.where && opts.where.trim().length > 0) predicates.push(`(${opts.where})`);
  const whereSql = predicates.length > 0 ? ` WHERE ${predicates.join(' AND ')}` : '';
  return (
    `SELECT ${cols} FROM ${opts.table}` +
    whereSql +
    ` ORDER BY ${cursorColumn} ASC LIMIT ${Math.max(1, Math.floor(opts.pageSize))}`
  );
}

/** The SELECT column list, materializing geometry per `geometryMode`. */
function selectColumns(opts: CartoPageOptions): string {
  const base = opts.columns && opts.columns.length > 0 ? opts.columns.join(', ') : '*';
  switch (opts.geometryMode) {
    case 'wkt':
      // Emit WKT text so the loader can ST_GeomFromText it.
      return `${base}, ST_AsText(the_geom) AS geom_wkt`;
    case 'geojson':
      return `${base}, ST_AsGeoJSON(the_geom) AS geom_geojson`;
    case 'none':
    case undefined:
    default:
      return base;
  }
}

/** Compose the full Carto SQL-API GET URL (q= query, format=json). */
export function buildCartoUrl(endpoint: string, sql: string): string {
  const u = new URL(endpoint);
  u.searchParams.set('q', sql);
  // JSON envelope ({ rows: [...] }); geometry already materialized in SELECT.
  u.searchParams.set('format', 'json');
  return u.toString();
}

/**
 * Fetch exactly one keyset page. Resolves the next cursor from the page's max
 * `cursorColumn`. Throws on non-2xx or malformed envelope — the CALLER decides
 * whether that aborts the source (it does not abort the whole nightly run;
 * other sources continue, PRD §3.1 "gate ≠ halt").
 */
export async function fetchCartoPage<Row = Record<string, unknown>>(
  opts: CartoPageOptions,
): Promise<CartoPage<Row>> {
  const cursorColumn = opts.cursorColumn ?? 'cartodb_id';
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available (pass opts.fetchImpl).');
  }
  const sql = buildKeysetSql(opts);
  const url = buildCartoUrl(opts.endpoint, sql);

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: string;
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Carto ${opts.table} HTTP ${res.status} ${res.statusText}`);
    }
    body = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let parsed: { rows?: unknown };
  try {
    parsed = JSON.parse(body) as { rows?: unknown };
  } catch {
    throw new Error(`Carto ${opts.table}: response was not JSON`);
  }
  if (!Array.isArray(parsed.rows)) {
    throw new Error(`Carto ${opts.table}: missing rows[] in envelope`);
  }
  const rows = parsed.rows as Row[];

  let nextCursor: number | null = opts.cursor ?? null;
  for (const r of rows) {
    const v = (r as Record<string, unknown>)[cursorColumn];
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && (nextCursor === null || n > nextCursor)) nextCursor = n;
  }

  return {
    rows,
    nextCursor,
    hasMore: rows.length >= Math.max(1, Math.floor(opts.pageSize)),
  };
}

/**
 * Async-generate every page from `startCursor` forward until a short page tells
 * us we've drained the table. Each yielded page carries its `nextCursor` so the
 * caller can commit `ops.source_cursor` every N pages for resumability.
 *
 * `maxPages` is a safety bound (e.g. for a bounded nightly increment); omit for a
 * full backfill.
 */
export async function* iterateCartoPages<Row = Record<string, unknown>>(
  opts: CartoPageOptions & { startCursor?: number | null; maxPages?: number },
): AsyncGenerator<CartoPage<Row>, void, void> {
  let cursor: number | null = opts.startCursor ?? opts.cursor ?? null;
  let pages = 0;
  for (;;) {
    if (opts.maxPages !== undefined && pages >= opts.maxPages) return;
    const page = await fetchCartoPage<Row>({ ...opts, cursor });
    pages += 1;
    if (page.rows.length === 0) return;
    yield page;
    if (!page.hasMore || page.nextCursor === null || page.nextCursor === cursor) return;
    cursor = page.nextCursor;
  }
}
