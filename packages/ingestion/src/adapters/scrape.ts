/**
 * Generic HTML-table scrape adapter (PRD §4.1, §4.2) — turns a `ScraperSpec` into a
 * `StagedBatch` of positional table rows.
 *
 * This module is 100% city-agnostic: it knows nothing about sheriff sales or
 * Philadelphia. It fetches each configured page (a browser UA + redirect-follow),
 * honors the robots Crawl-delay BETWEEN page fetches, and — because the cells are
 * POSITIONAL `<td>` with no keys — asserts the page's FIRST `<thead>` matches the
 * adapter's `expectedColumns` BEFORE parsing. Column-order drift THROWS: that
 * assertion is the only safety net, so it is the source's integrity gate (the caller
 * turns the throw into a `failed` run + alert, and the rest of the nightly continues).
 *
 * Each parsed row is an object keyed by the asserted header names, PLUS two injected
 * fields the adapter mapping consumes: `__sale_type` (the page-derived canonical sale
 * type) and `__source_url` (the page URL). The HTTP transport + sleep are injected so
 * the default test suite stays offline and never actually waits the Crawl-delay.
 */
import * as cheerio from 'cheerio';
import type { ScraperSpec } from '@bandbox/core/contracts';
import type { DbClient } from '../db.js';
import type { StagedBatch } from '../pipeline.js';
import type { SourceFetcher } from '../run.js';

/** Minimal HTTP GET we rely on (Node 18+ global `fetch` Response satisfies it). */
export type HttpGet = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export interface ScrapeFetchOptions {
  /** Injected HTTP transport (defaults to a redirect-following fetch with a browser UA). */
  httpGet?: HttpGet;
  /** Injected sleep (defaults to real setTimeout; tests pass a no-op to skip the delay). */
  sleep?: (ms: number) => Promise<void>;
  /** Per-request network timeout in ms (default 30_000) — a stalled host must not hang the run. */
  timeoutMs?: number;
}

/** A realistic desktop UA — some WAFs reject default/empty agents. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Default GET with an AbortController timeout (mirrors the Carto fetcher). Without it a
 * stalling/trickling host would block the SERIAL nightly indefinitely with no `failed`
 * status and no alert; the abort turns a stall into a reject the orchestrator can report.
 */
function makeDefaultHttpGet(timeoutMs: number): HttpGet {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': BROWSER_UA },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse ONE scraped HTML page into positional rows. Asserts the FIRST `<thead>`'s
 * column order equals `expectedColumns` (throws on drift — the gate), then reads each
 * `<tbody> <tr>`'s `<td>` cells positionally into a record keyed by the header names.
 * Stamps every row with the injected page context (`__sale_type`, `__source_url`).
 *
 * Robust to the page rendering TWO theads (a sticky/clone header): we assert against
 * the first and read the body rows of that thead's own `<table>` exactly once.
 */
export function parseScrapeTable(
  html: string,
  expectedColumns: readonly string[],
  context: { saleType: string; sourceUrl: string },
): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const thead = $('thead').first();
  if (thead.length === 0) {
    throw new Error(`scrape ${context.sourceUrl}: no <thead> found (page structure changed)`);
  }
  const header = thead
    .find('th')
    .map((_, el) => $(el).text().trim())
    .get();

  const drift =
    header.length !== expectedColumns.length || header.some((h, i) => h !== expectedColumns[i]);
  if (drift) {
    throw new Error(
      `scrape ${context.sourceUrl}: column-order drift — expected [${expectedColumns.join(
        ', ',
      )}] got [${header.join(', ')}]`,
    );
  }

  const table = thead.closest('table');
  const rows: Record<string, unknown>[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get();
    if (cells.length === 0) return; // skip spacer / non-data rows
    const row: Record<string, unknown> = {
      __sale_type: context.saleType,
      __source_url: context.sourceUrl,
    };
    for (let i = 0; i < expectedColumns.length; i++) {
      row[expectedColumns[i]!] = cells[i] ?? null;
    }
    rows.push(row);
  });
  return rows;
}

/**
 * Build a `SourceFetcher` for a scraped source. A full re-scrape every run: fetches
 * each page (Crawl-delay honored between pages), asserts + parses each, and returns
 * one combined `StagedBatch` with `nextCursor: null` (no keyset cursor — the source's
 * idempotency is the `listing_id` upsert in `promote`). The DB handle is unused (no
 * cursor state to read).
 *
 * ALL-OR-NOTHING (deliberate): any page that errors (non-2xx), drifts (column-order),
 * or falls below its `minRows` floor THROWS, which aborts the whole fetch — the
 * orchestrator records the source `failed` + alerts and promotes nothing, including
 * any already-parsed healthy page. The full re-scrape is idempotent, so the healthy
 * page is fully recovered on the next clean run; we prefer a loud failure over a
 * silent partial promote.
 */
export function makeScrapeFetcher(scraper: ScraperSpec, opts: ScrapeFetchOptions = {}): SourceFetcher {
  const httpGet = opts.httpGet ?? makeDefaultHttpGet(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const sleep = opts.sleep ?? defaultSleep;
  return async (spec, _db: DbClient): Promise<StagedBatch> => {
    const rows: Record<string, unknown>[] = [];
    let first = true;
    for (const page of scraper.pages) {
      if (!first && scraper.crawlDelaySec > 0) await sleep(scraper.crawlDelaySec * 1000);
      first = false;
      const res = await httpGet(page.url);
      if (!res.ok) {
        throw new Error(`scrape ${page.url}: HTTP ${res.status} ${res.statusText}`);
      }
      const html = await res.text();
      const pageRows = parseScrapeTable(html, scraper.expectedColumns, {
        saleType: page.saleType,
        sourceUrl: page.url,
      });
      // Sanity floor: a header-valid page that parses near-zero rows is a tbody-markup
      // break, NOT a legitimately empty week — fail loudly so it isn't a silent no-op.
      if (page.minRows !== undefined && pageRows.length < page.minRows) {
        throw new Error(
          `scrape ${page.url}: parsed ${pageRows.length} rows, below floor ${page.minRows} — ` +
            `likely a tbody-structure change with an intact header`,
        );
      }
      rows.push(...pageRows);
    }
    return { source: spec.name, rows, nextCursor: null };
  };
}
