/**
 * Scrape fetcher + parser tests (PRD §4.2, §9 DoD). Golden fixtures are the REAL
 * server-rendered Ninja-Table HTML (thead + 6 rows, incl. a Postponed row) saved
 * during live recon 2026-06-18. The column-order assertion is the source's only
 * safety net (positional cells), so the adversarial case here is header drift.
 */
import { describe, it, expect, vi } from 'vitest';
import { philadelphia } from '@bandbox/core';
import type { ScraperSpec } from '@bandbox/core/contracts';
import { makeScrapeFetcher, parseScrapeTable, type HttpGet } from '../src/adapters/scrape.js';
import { FakeDb, readFixture } from './helpers.js';

const scraper = philadelphia.scraper!;
const EXPECTED = scraper.expectedColumns;
const mortgageHtml = readFixture('sheriff/mortgage_table.html');
const foreclosureHtml = readFixture('sheriff/foreclosure_table.html');

describe('parseScrapeTable (golden fixtures)', () => {
  it('parses the mortgage page into positional rows tagged with page context', () => {
    const rows = parseScrapeTable(mortgageHtml, EXPECTED, {
      saleType: 'mortgage',
      sourceUrl: 'https://example.test/mortgage/',
    });
    expect(rows.length).toBe(6); // fixture: 5 Preview + 1 Postponed
    const first = rows[0]!;
    expect(first.ID).toBe('84714');
    expect(first.BooknWrit).toBe('2602-371');
    expect(first.AssessmentID).toBe('522145900');
    expect(first.Street).toBe('5818 WOODCREST AVENUE PHILADELPHIA PA 19131');
    expect(first.SaleType).toBe('MORTGAGE FORECLOSURE');
    expect(first.SaleStatus).toBe('Preview');
    expect(first.SaleDate).toBe('2026-07-07');
    // injected page context (consumed by the adapter mapping)
    expect(first.__sale_type).toBe('mortgage');
    expect(first.__source_url).toBe('https://example.test/mortgage/');
    // the Postponed row is present and parsed
    const postponed = rows.find((r) => r.SaleStatus === 'Postponed');
    expect(postponed?.AssessmentID).toBe('612270700');
  });

  it('parses the foreclosure (tax) page, preserving the raw varied SaleType', () => {
    const rows = parseScrapeTable(foreclosureHtml, EXPECTED, {
      saleType: 'tax',
      sourceUrl: 'https://example.test/foreclosure/',
    });
    expect(rows.length).toBe(6);
    expect(rows[0]!.SaleType).toBe('Linebarger');
    // a postponed tax row carries a different raw SaleType — preserved verbatim
    const postponed = rows.find((r) => r.SaleStatus === 'Postponed');
    expect(postponed?.SaleType).toBe('TAX COLLECTION LINEBARGER 2000');
    // trailing whitespace in a BooknWrit cell is trimmed
    expect(rows[3]!.BooknWrit).toBe('2606-2021');
  });

  it('THROWS on column-order drift (the gate) — a reordered header is rejected', () => {
    const reordered = mortgageHtml
      .replace('ninja_clmn_nm_BooknWrit ">BooknWrit', 'ninja_clmn_nm_BooknWrit ">AssessmentID')
      .replace('ninja_clmn_nm_AssessmentID ">AssessmentID', 'ninja_clmn_nm_AssessmentID ">BooknWrit');
    expect(() => parseScrapeTable(reordered, EXPECTED, { saleType: 'mortgage', sourceUrl: 'u' })).toThrow(
      /column-order drift/,
    );
  });

  it('THROWS when a header column is missing (count mismatch)', () => {
    const html =
      '<table><thead><tr><th>ID</th><th>BooknWrit</th></tr></thead>' +
      '<tbody><tr><td>1</td><td>x</td></tr></tbody></table>';
    expect(() => parseScrapeTable(html, EXPECTED, { saleType: 'mortgage', sourceUrl: 'u' })).toThrow(
      /column-order drift/,
    );
  });

  it('asserts the FIRST thead and reads body rows once when a clone thead is present', () => {
    // Simulate the live page rendering TWO theads (sticky clone). The first is canonical.
    const head =
      '<thead><tr>' + EXPECTED.map((c) => `<th>${c}</th>`).join('') + '</tr></thead>';
    const body =
      '<tbody><tr>' +
      ['9', '1-1', '123456789', 'ST', 'MORTGAGE FORECLOSURE', 'Preview', '2026-07-07']
        .map((c) => `<td>${c}</td>`)
        .join('') +
      '</tr></tbody>';
    const html = `<table>${head}${head}${body}</table>`;
    const rows = parseScrapeTable(html, EXPECTED, { saleType: 'mortgage', sourceUrl: 'u' });
    expect(rows.length).toBe(1); // body parsed exactly once despite two theads
    expect(rows[0]!.AssessmentID).toBe('123456789');
  });
});

describe('makeScrapeFetcher', () => {
  function httpFor(map: Record<string, string>): HttpGet {
    return async (url) => {
      const html = map[url];
      if (html === undefined) throw new Error(`unexpected url ${url}`);
      return { ok: true, status: 200, statusText: 'OK', text: async () => html };
    };
  }

  const sheriffSpec = philadelphia.sources.find((s) => s.name === 'sheriff_sales')!;
  // The 6-row fixtures sit below the real minRows floors (100/50); drop the floor for
  // happy-path tests and exercise the floor explicitly in its own test.
  const lowFloor = { ...scraper, pages: scraper.pages.map((p) => ({ ...p, minRows: 1 })) };

  it('fetches every page, honors the Crawl-delay BETWEEN pages, returns a combined batch', async () => {
    const db = new FakeDb();
    const httpGet = httpFor({
      [scraper.pages[0]!.url]: mortgageHtml,
      [scraper.pages[1]!.url]: foreclosureHtml,
    });
    const sleep = vi.fn(async () => {});
    const batch = await makeScrapeFetcher(lowFloor, { httpGet, sleep })(sheriffSpec, db.client);
    expect(batch.rows.length).toBe(12); // 6 mortgage + 6 tax
    expect(batch.nextCursor).toBeNull(); // full re-scrape, no cursor
    // Crawl-delay slept once (between the two pages), at the configured seconds.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(scraper.crawlDelaySec * 1000);
    // mortgage rows tagged 'mortgage', tax rows tagged 'tax'
    expect(batch.rows.filter((r) => r.__sale_type === 'mortgage').length).toBe(6);
    expect(batch.rows.filter((r) => r.__sale_type === 'tax').length).toBe(6);
  });

  it('THROWS on a non-2xx page (the orchestrator turns this into a failed run + alert)', async () => {
    const db = new FakeDb();
    const httpGet: HttpGet = async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => '' });
    await expect(
      makeScrapeFetcher(scraper, { httpGet, sleep: async () => {} })(sheriffSpec, db.client),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('THROWS when a page parses BELOW its minRows floor (silent tbody-break guard)', async () => {
    // Header intact, only 6 rows, but the mortgage floor is 100 → must fail loudly,
    // NOT return a near-empty batch that reports as a clean success.
    const db = new FakeDb();
    const httpGet = httpFor({
      [scraper.pages[0]!.url]: mortgageHtml, // 6 rows < floor 100
      [scraper.pages[1]!.url]: foreclosureHtml,
    });
    await expect(
      makeScrapeFetcher(scraper, { httpGet, sleep: async () => {} })(sheriffSpec, db.client),
    ).rejects.toThrow(/below floor 100/);
  });
});
