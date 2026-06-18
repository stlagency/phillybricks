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
Forward auctions are not in open data. Source = `phillysheriff.com/mortgage/` + `/foreclosure/` (server-rendered Ninja Tables). The adapter `scraper` config is already defined (`philadelphia.scraper`: urls, `expectedColumns`, `crawlDelaySec: 10`).
1. Build a scraper adapter (cheerio is already a dep): fetch each page, **assert `<thead>` column order matches `expectedColumns` before parsing** (fail loudly on layout drift), honor the Crawl-delay.
2. Map rows → `public.sheriff_listing`: `raw_assessment_id` = the dirty `AssessmentID`; `parcel_pk` = `normParcelKey(AssessmentID)` (kept even when null); `sale_type` DERIVED from which page (mortgage vs foreclosure→tax), `source_sale_type` = raw; `sale_status` core vocab only. Bid4Assets enrichment stays OFF by default.
3. Wire it as a `weekly` source (it has no `mapping`/`platform:'scrape'` fetcher yet — add a scrape fetcher path in `run.ts` alongside carto/s3, or a dedicated step).
4. **Adversarial gate:** golden-fixture test on the saved HTML (column-order assertion, 9-digit OPA join, mortgage-vs-tax derivation). PRD §9 DoD.

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
