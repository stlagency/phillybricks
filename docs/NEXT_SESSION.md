# PhillyBricks — resume here (next session)

**M0 + M1 + M1a are complete and the production warehouse is live with real, accruing data.** The nightly ingests all 14 open-data sources, the four correctness gates are wired, and `parcel_change_log` history is accruing (the one irreplaceable asset, PRD §0.6). Your next milestone is **M2: the sheriff-sale scraper** (forward auctions are NOT in open data), then **M3: real derived/matview logic**.

Read `PRD.md` (engineering truth), `CONCEPT_v2_shared_understanding.md` (scope), `design/DESIGN.md` + `TOKENS.css` (UI), `docs/DATA_SOURCES.md` (data facts). Project memory (`philly-open-data-facts`, `philly-tool-v1-decisions`) loads automatically.

---

## What's DONE (don't redo)

- **Repo:** https://github.com/stlagency/phillybricks — public, AGPL, secret-scanning + push-protection. CI green (typecheck/lint/test · portability gate · static + live `pg_catalog` RLS gate · gitleaks).
- **Monorepo:** `packages/core` (CityAdapter `philadelphia` + transfer flags + distress/comps + **declarative `SourceMapping` column-maps** for all 14 sources + coercion/geom-marker helpers), `packages/db` (10 migrations + runner), `packages/ingestion` (mapping-driven upsert engine, change-log/event diff, Carto-keyset + OPA-bulk fetchers, per-source steps, resumable backfill, nightly worker), `packages/tiles`, `apps/web`, `infra/`. `pnpm run verify` is green (db 101 · core 229 · tiles 11 · ingestion 80 tests · portability + security gates).
- **Production Supabase live** (`ctcvrdsrylauqpuxbauz`): **10 migrations** applied (0010 added `tax_delinquency`/`tax_balance`/`business_license`). 18 public tables RLS-enabled + grant-locked.
- **M1 ingestion COMPLETE + verified live (2026-06-18):**
  - OPA spine loaded: **583,617 parcels** (583,507 with geometry; `shape` column is `SRID=2272;POINT` → `ST_Transform`'d to 4326; 37,545 out-of-state owners — matches the ~37.8K baseline).
  - **`parcel_change_log`: 2,329,657 baseline rows** across 4 tracked fields (owner_1/market_value/sale_price/sale_date). Idempotent (a re-loaded spine adds 0 rows).
  - All 13 Carto sources promote; `delinquency_event` (54,399) + `violation_event` (7,070) diffs fire.
  - **Nightly is GREEN end-to-end: 14 ok, 0 failed.** Gate ≠ halt verified. Empty/drained/lagging sources are clean no-ops (not false quarantines). Soft-retire never fires on an empty batch.
  - **`expectedJoinRate` baselines MEASURED live** and set in `philadelphia.ts` (permits 0.85, violations/complaints/cases 0.90, demolitions 0.75, tax 0.88, biz-license 0.72, RTT floored to **0.45** because historic 1974-era deeds legitimately join low — the count reconcile is RTT's real gate, not the per-batch join gate).
  - Adversarial review (6 parallel skeptics + independent verification) over upsert/spine/change-log/decoy/cursor/window: **0 confirmed bugs**. The 3 bugs that mattered were caught by the LIVE run (violation_event NOT-NULL, intra-batch ON-CONFLICT dedup, empty-batch false-quarantine) and fixed.
- **M1a RTT backfill:** resumable streaming loader (`src/backfill.ts` + `scripts/backfill-rtt.ts`), keyset on `cartodb_id`, commits `ops.source_cursor` every 5 pages, 6h-budgeted, reconciles count ±0.5%. **Running now** to drain rtt_summary to 1974 — re-runnable until `drained`; check `ops.source_cursor` / `ops.ingest_run` for progress.

### Architecture notes carried forward
- **Portability:** all Philly source literals (column names, table names, the decoy `parcel_id_num`) live ONLY in `packages/core/src/adapters/`. Ingestion is generic: it consumes each source's `SourceMapping.mapRow` (raw→canonical) + `windowPredicate`; the gate fails the build on a leak.
- **OPA is the spine** → `expectedJoinRate: undefined` (exempt from the parcel-join gate, which would read 0% on first load). Its gate is the freshness gate (Last-Modified + row-count ±5%) in `makeOpaFetcher`; it promotes in chunked statements (no single giant tx), soft-retires, accrues change-log, then the parcel-key index is refreshed so keyed sources measure against real parcels.
- **Cursor advances only after a successful promote** (a quarantine/failure leaves it, so the delta re-fetches). OPA stores its Last-Modified in `source_cursor.watermark`.
- **Local run:** `DATABASE_URL="$(cat <memory>/database-url.secret)" NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @phillybricks/ingestion run run:nightly` (set `NIGHTLY_MAX_PAGES` to bound per-run carto fetch; default 40).

## YOUR TASK — M2: sheriff-sale scraper (PRD §4.2, §9)
Forward auctions are not in open data. **Live recon done 2026-06-18 — config is corrected and golden fixtures are saved**, so this should be a clean build:
- Source pages (`philadelphia.scraper.urls`, NON-www — www 301-redirects): `https://phillysheriff.com/mortgage/` (≈909 rows, all `MORTGAGE FORECLOSURE`) + `/foreclosure/` (≈667 tax rows). **Server-rendered Ninja Tables — every row is in the HTML** (no AJAX/pagination to chase). robots.txt: Crawl-delay 10, paths allowed.
- **Verified column order** (`philadelphia.scraper.expectedColumns`): `ID, BooknWrit, AssessmentID, Street, SaleType, SaleStatus, SaleDate`. Cells are POSITIONAL `<td>` (no data-* keys) → the thead-order assertion is the only safety net. Each page renders TWO theads (a clone) — assert against the first.
- **Golden fixtures saved**: `packages/ingestion/test/fixtures/sheriff/{mortgage,foreclosure}_table.html` (real thead + 6 rows incl. a Postponed row). Build the test against these.

1. Build a scraper fetcher (cheerio is a dep): fetch each page (follow redirects, send a browser UA, honor Crawl-delay 10), **assert the first `<thead>` matches `expectedColumns` before parsing** (throw on drift — that's the gate), parse the tbody rows positionally.
2. Map → `public.sheriff_listing`: `listing_id` = a stable id (e.g. `sheriff:<AssessmentID>:<BooknWrit>` — the `ID` column is an internal seq that may not be stable); `raw_assessment_id` = dirty `AssessmentID`; `parcel_pk` = `normParcelKey(AssessmentID)` (kept even when null — AssessmentID is a clean 9-digit OPA so joins ~well); `sale_type` DERIVED from the PAGE (mortgage→'mortgage', foreclosure→'tax'), `source_sale_type` = raw `SaleType` (Linebarger/GRB/TAX…); `sale_status` = lower(`SaleStatus`) ∈ {preview, postponed}; `sale_date` = `SaleDate` (ISO already); `street` = `Street`; `book_writ` = `BooknWrit`; `source_url` = the page. plaintiff/opening_bid/judgment/attorney stay NULL (Bid4Assets enrichment, OFF by default). Reuse the declarative `SourceMapping`/upsert engine if it fits, OR a small dedicated scrape step.
3. Wire as a `weekly` `platform:'scrape'` source: add a scrape branch in `run.ts` (alongside the carto/s3 branches) or a dedicated runner; sheriff listings are a full re-scrape each run (idempotent upsert on `listing_id`), no keyset cursor.
4. **Adversarial gate (PRD §9 DoD):** golden-fixture test — column-order assertion fires on a reordered header; mortgage-vs-tax `sale_type` derivation; 9-digit OPA → parcel_pk; Postponed→postponed; a null/garbage AssessmentID is kept with null parcel_pk. Then run live + confirm rows land in `public.sheriff_listing` and feed `distress_signal.on_sheriff_list` (M3 matview).

## After M2 → M3 derived (REAL matview logic in `packages/core` + **matview ownership fix**, incremental `geo_metric`, geo-stamp crime/311 + parcels via `geo_boundary` point-in-polygon, comps) · M4 serving + PMTiles→R2 + MapLibre map (**Vercel Pro + R2 needed**) · M5 deep-dive `/api/parcel/:pk` · M6 leads + BYO skip-trace · M7 accounts + Stripe + alerts (**Stripe + Resend needed**).

### Gotchas
- **Matview REFRESH ownership (M3):** `phillybricks_worker` is not the owner of `distress_signal`/`comp_candidate` (postgres is) and PG16 blocks `grant postgres`. `refreshDerived` is a NO-OP in M1 — resolve in M3 (reassign matview ownership to the worker via the MCP `postgres` session, or refresh as postgres).
- **Heavy loads:** the in-memory nightly OPA batch (~584K) wants `--max-old-space-size=4096`. The backfill streams page-by-page (bounded memory).
- **Apply new migrations** to prod via the Supabase MCP `apply_migration` (project `ctcvrdsrylauqpuxbauz`) AND keep `packages/db/migrations/` in sync; add new public tables to `PUBLIC_TABLES` in `packages/db/src/index.ts` (the security gate test asserts the set).

## How to verify state on resume
- `pnpm install && pnpm run verify` → all green.
- Live DB via Supabase MCP `execute_sql`: `select count(*) from public.parcel;` (=583,617), `select count(*) from public.parcel_change_log;` (≥2.3M), and `select source, status, rows_promoted from ops.ingest_run order by id desc limit 20;`.
- RTT backfill progress: `select * from ops.source_cursor where source='rtt_summary';` and `select count(*) from public.transfer;` (climbing toward ~5.1M).

## Human pause-points still open (not blockers for M2/M3)
- **Vercel Pro** + env (`SUPABASE_URL`=`https://ctcvrdsrylauqpuxbauz.supabase.co`, anon/publishable + service_role) — **M4**.
- **R2** bucket + keys — **M4** tiles.
- **Stripe** + **Resend** keys — **M7**.
- **healthchecks.io** monitor URL (`HEALTHCHECKS_URL` secret) — wire the liveness dead-man's-switch when convenient.
