/**
 * M2 sheriff-scrape runner / live verifier (PRD §4.2, §9 DoD).
 *
 * Exercises the REAL production primitives — `makeScrapeFetcher` (live fetch + the
 * <thead> column-order gate + positional parse, honoring Crawl-delay) and
 * `makeStepsForSpec` (the mapping-driven idempotent upsert on listing_id) — against
 * phillysheriff.com and, when DATABASE_URL is set, the prod warehouse.
 *
 *   # parse-only (no DB) — confirms today's live HTML still matches the recon header:
 *   pnpm --filter @bandbox/ingestion exec tsx scripts/run-sheriff.ts parse-only
 *
 *   # full live run → upsert into public.sheriff_listing + verify it feeds distress:
 *   DATABASE_URL="$(cat <memory>/database-url.secret)" \
 *     pnpm --filter @bandbox/ingestion exec tsx scripts/run-sheriff.ts
 *
 * Not part of the build (outside tsconfig include). Idempotent: re-running re-upserts.
 */
import { philadelphia } from '@bandbox/core';
import { asDbClient, connectFromEnv } from '../src/db.js';
import { makeScrapeFetcher } from '../src/adapters/scrape.js';
import { makeStepsForSpec } from '../src/steps.js';
import { closeIngestRun, openIngestRun } from '../src/ingestRun.js';

const parseOnly = process.argv.includes('parse-only');

async function main(): Promise<void> {
  const scraper = philadelphia.scraper;
  const spec = philadelphia.sources.find((s) => s.name === scraper?.sourceName);
  if (!scraper || !spec?.mapping) throw new Error('no scraper config / sheriff source');

  console.log(`[scrape] fetching ${scraper.pages.length} page(s), Crawl-delay ${scraper.crawlDelaySec}s …`);
  const t0 = Date.now();
  const batch = await makeScrapeFetcher(scraper)(spec, undefined as never);
  console.log(`[scrape] parsed ${batch.rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Page breakdown + parcel-key derivability (a proxy for the eventual parcel join).
  for (const page of scraper.pages) {
    const pageRows = batch.rows.filter((r) => r.__source_url === page.url);
    const mapped = pageRows.map((r) => spec.mapping!.mapRow(r)).filter((m) => m !== null);
    const withPk = mapped.filter((m) => m!.parcel_pk !== null).length;
    console.log(
      `  ${page.saleType.padEnd(9)} ${page.url}: ${pageRows.length} rows, ${mapped.length} mapped, ` +
        `${withPk} (${pageRows.length ? ((withPk / pageRows.length) * 100).toFixed(1) : '0'}%) with parcel_pk`,
    );
  }
  // A couple of sample mapped rows for eyeballing.
  for (const r of batch.rows.slice(0, 2)) {
    console.log('  sample:', JSON.stringify(spec.mapping.mapRow(r)));
  }

  if (process.argv.includes('keycheck')) {
    // Candidate-key collision analysis: which grain is unique in the live source?
    const candidates: Record<string, (r: Record<string, unknown>) => string> = {
      'ID': (r) => `${r.ID}`,
      'Assessment+BooknWrit': (r) => `${r.AssessmentID}|${r.BooknWrit}`,
      'Assessment+BooknWrit+Status': (r) => `${r.AssessmentID}|${r.BooknWrit}|${r.SaleStatus}`,
      'Assessment+BooknWrit+Status+Date': (r) => `${r.AssessmentID}|${r.BooknWrit}|${r.SaleStatus}|${r.SaleDate}`,
      'BooknWrit+Status+Date': (r) => `${r.BooknWrit}|${r.SaleStatus}|${r.SaleDate}`,
      'Assessment+BooknWrit+ID': (r) => `${r.AssessmentID}|${r.BooknWrit}|${r.ID}`,
    };
    console.log(`\n[keycheck] ${batch.rows.length} rows; distinct values per candidate grain:`);
    for (const [name, fn] of Object.entries(candidates)) {
      const set = new Set(batch.rows.map(fn));
      console.log(`  ${name.padEnd(34)} distinct=${set.size}  collisions=${batch.rows.length - set.size}`);
    }
  }

  if (process.argv.includes('diagnose')) {
    // Duplicate-key analysis: is listing_id (AssessmentID+BooknWrit) unique in the source?
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of batch.rows) {
      const m = spec.mapping.mapRow(r);
      if (!m) continue;
      const key = String(m.listing_id);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    const collisions = [...groups.entries()].filter(([, rs]) => rs.length > 1);
    console.log(`\n[diagnose] ${groups.size} distinct listing_id of ${batch.rows.length} rows; ${collisions.length} colliding keys`);
    let exactDup = 0;
    let differing = 0;
    const cols = ['ID', 'BooknWrit', 'AssessmentID', 'Street', 'SaleType', 'SaleStatus', 'SaleDate'];
    for (const [, rs] of collisions) {
      const sigs = new Set(rs.map((r) => cols.map((c) => String(r[c] ?? '')).join('|')));
      if (sigs.size === 1) exactDup++;
      else differing++;
    }
    console.log(`[diagnose] colliding keys that are EXACT row duplicates: ${exactDup}; with DIFFERING columns: ${differing}`);
    // Show up to 4 DIFFERING collisions in full (the dangerous case).
    let shown = 0;
    for (const [key, rs] of collisions) {
      const sigs = new Set(rs.map((r) => cols.map((c) => String(r[c] ?? '')).join('|')));
      if (sigs.size === 1 || shown >= 4) continue;
      shown++;
      console.log(`[diagnose] DIFFERING key ${key}:`);
      for (const r of rs) console.log('   ', cols.map((c) => `${c}=${String(r[c] ?? '')}`).join('  '));
    }
  }

  if (parseOnly || !process.env.DATABASE_URL) {
    console.log(parseOnly ? '\n[parse-only] DB write skipped.' : '\n[no DATABASE_URL] DB write skipped.');
    return;
  }

  const sql = connectFromEnv();
  const db = asDbClient(sql);
  try {
    const steps = makeStepsForSpec(spec);
    const runId = await openIngestRun(db, spec.name);
    console.log(`\n[db] promoting ${batch.rows.length} rows (idempotent upsert on listing_id)…`);
    const promoted = await db.begin((tx) => steps.promote(tx, batch, null));
    await closeIngestRun(db, { id: runId, status: 'success', rowsIn: batch.rows.length, rowsPromoted: promoted });
    console.log(`[db] promoted ${promoted}.`);

    const total = (await db.unsafe(`select count(*)::int n from public.sheriff_listing`)) as { n: number }[];
    const byType = (await db.unsafe(
      `select sale_type, sale_status, count(*)::int n from public.sheriff_listing group by 1,2 order by 1,2`,
    )) as { sale_type: string; sale_status: string; n: number }[];
    const joined = (await db.unsafe(
      `select count(*)::int n from public.sheriff_listing s
         join public.parcel p on p.parcel_pk = s.parcel_pk where s.parcel_pk is not null`,
    )) as { n: number }[];
    const nullPk = (await db.unsafe(
      `select count(*)::int n from public.sheriff_listing where parcel_pk is null`,
    )) as { n: number }[];
    const onList = (await db.unsafe(
      `select count(distinct parcel_pk)::int n from public.sheriff_listing where parcel_pk is not null`,
    )) as { n: number }[];

    console.log(`\n[verify] public.sheriff_listing total = ${total[0]?.n}`);
    console.log(`[verify]   parcel_pk NULL (kept) = ${nullPk[0]?.n}`);
    console.log(`[verify]   join to public.parcel = ${joined[0]?.n} of ${(total[0]?.n ?? 0) - (nullPk[0]?.n ?? 0)} non-null`);
    console.log(`[verify]   distinct parcels → distress_signal.on_sheriff_list = ${onList[0]?.n}`);
    for (const r of byType) console.log(`[verify]   ${r.sale_type ?? 'null'} / ${r.sale_status ?? 'null'}: ${r.n}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('sheriff run failed:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
