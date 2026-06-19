# Bandbox — Implementation Plan / PRD (v1.1)
*Philadelphia residential real-estate market intelligence.*

**Companion docs:** product/scope decisions → `CONCEPT_v2_shared_understanding.md`; verified data facts → `docs/DATA_SOURCES.md` (in-repo); design system → `design/DESIGN.md` + `TOKENS.css` (canonical, "The Survey Table, Warmed").
**Role of this doc:** the engineering source of truth. It feeds (1) a UI/UX exploration via the `impeccable` skill — so this PRD fixes *what each surface does and its data contract*, NOT its visual/interaction design; (2) an ultracode workflow build plan that pipelines these milestones.
**v1.1 changelog:** hardened after a 7-dimension adversarial review. Material corrections: empirical per-source join gates + OPA `pin` (RTT joins ~60% on `parcel_number`), `cartodb_id` keyset pagination, corrected cost floor (~$45/mo, Vercel Pro required), full RLS/grant + secret model, Stripe webhook verification, skip-trace decrypt boundary, geometry extraction, estate-name-regex derivation, email-delivery spec, backup/liveness milestones, `CityAdapter` interface, test fixtures.
**Date:** 2026-06-18.

---

## 0. Principles
1. **Transparency-first.** Every derived number is decomposable and links to its raw public record. No black boxes (no ML AVM).
2. **Educational.** Inline explainers + glossary are first-class.
3. **Open-source (AGPL-3.0), public from commit 1.** No secret ever enters the repo. `.env.example` + self-host docs from day one.
4. **Low-markup / cheap to run.** ~$45/mo baseline (§8). Storage discipline (change-logs + windowing + land-transform-discard of raw).
5. **Philly now, portable later.** All city-specific logic lives behind a `CityAdapter` (§2.1); a second city is config + adapters, not a rewrite.
6. **Ingestion-first.** Stand up nightly ingestion before UI polish — state history can only accrue forward, and our change-log tables are the irrecoverable source of truth for it.

---

## 1. Users & access tiers
| Tier | Who | Gets |
|---|---|---|
| **Anonymous** (free) | Public / SEO | Full market-scan map, property deep-dive, comps + value estimate, glossary. Read-only. |
| **Authenticated** (free; monetization deferred to M8) | Investors | + saved target areas, alerts, leads mini-CRM, CSV export, BYO skip-trace orchestration. |

Auth: Supabase Auth. The personalization/automation surfaces are **login-gated but free** — monetization is deferred to **M8**. The entitlement seam (`app.subscription.status='active'`, RLS + API check) is built and kept **dormant** (unenforced) until then. No *data* is ever paywalled — only personalization/automation, and currently nothing.

---

## 2. Architecture & repo
```
Carto SQL ─┐
S3 bulk ───┤  GitHub Actions cron (nightly, UTC + repo-mutating keep-alive)
phillysheriff scrape ─┼─► ingestion worker (TS, service_role)
geo files (1-time) ───┘   normalize → stage → validate(gate) → promote → diff→change-log/alert → refresh derived → build tiles
(ArcGIS = phase 2) ─ ─ ┘
                              │
                              ▼
                Supabase Postgres + PostGIS (Pro, 8GB)
                  raw.* landing · public.* canonical+derived (GRANT SELECT to anon) · app.* user (RLS) · ops.* internal
                  matviews (CONCURRENTLY): distress_signal, comp_candidate · table (incremental upsert): geo_metric
                              │
        ┌─────────────────────┼───────────────────────┐
        ▼                     ▼                         ▼
 tippecanoe → PMTiles    PostgREST + Next API      Supabase Auth · ZeptoMail (email) · Stripe (deferred M8)
 → Supabase Storage (CDN)     │
        ▼                     ▼
 MapLibre (base) + deck.gl (overlays) · Next on Vercel (Pro)
```
External heartbeat (healthchecks.io free) pinged on each successful run → alerts on *absence* of a run.

**Monorepo (pnpm workspaces):** `apps/web` (Next App Router, MapLibre+deck.gl) · `packages/db` (SQL migrations, RLS/grants, matview defs, generated TS types) · `packages/ingestion` (worker, adapters, scraper, diff/alert, run-logging) · `packages/core` (pure logic: comps, value estimate, distress scoring, arms-length/estate derivation, `CityAdapter`) · `packages/tiles` (tippecanoe → PMTiles → Supabase Storage) · `infra/` (Actions workflows, docker-compose self-host, docs). TypeScript end-to-end.

### 2.1 `CityAdapter` contract (the portability seam — no Philly literal lives outside `packages/core/adapters/`)
```ts
interface CityAdapter {
  city: string;                          // 'philadelphia'
  sources: SourceSpec[];                 // see below
  normParcelKey(raw: string): string|null; // §3.1 rule
  documentTypes: {                       // §5.1 vocab (Philly values verified live)
    armsLength: string[]; distress: string[]; sheriff: string[];
    estateNameRegex: RegExp;             // ESTATE OF|EXECUTOR|EXECUTRIX|ADMINISTRATOR|ADMINISTRATRIX|TRUSTEE
  };
  nominalConsiderationFloor: number;     // e.g. 1000
  geoSources: { kind:'zip'|'neighborhood'|'tract'; url:string; idField:string }[];
  scraper?: { urls:string[]; expectedColumns:string[]; crawlDelaySec:number };
  lensMetricSql: Record<LensMetric, string>;
}
interface SourceSpec {
  name: string; platform:'carto'|'s3'|'scrape'|'file'; endpoint:string;
  keyColumns: string[];                  // candidate parcel-key columns to normalize+try
  cursorColumn?: string;                 // 'cartodb_id' for keyset pagination
  incrementalColumn?: string;            // delta predicate only, NOT page ordering
  geometryMode?: 'wkt'|'geojson'|'none'; // how coords arrive
  cadence:'nightly'|'weekly'|'once'; expectedJoinRate?: number; // per-source gate baseline
}
```
A CI grep gate fails the build on Philly literals (table names, URLs) found outside `packages/core/adapters/`.

---

## 3. Data model

### 3.1 Conventions & the parcel key
- **Canonical key** `parcel_pk text` = 9-digit OPA id. Normalizer asserts exactly 9 digits; anything else → NULL + quarantine (never silent-pad arbitrary length):
  ```sql
  create or replace function norm_parcel(raw text) returns text language sql immutable as $$
    with d as (select regexp_replace(coalesce(raw,''),'\D','','g') as x)
    select case when length(x)=9 then x
                when length(x) between 1 and 8 then lpad(x,9,'0')
                else null end          -- >9 digits or empty → reject (quarantine + count)
    from d;
  $$;
  ```
  Malformed/over-long keys route to `ops.parcel_key_quarantine` and increment `ops.ingest_run.malformed_key_count`. **Never** join on L&I `parcel_id_num` (decoy).
- **The join is empirical, not assumed.** RTT→OPA on `parcel_number` is documented at only ~60% (OpenDataPhilly); the fix is OPA's `pin`. Therefore: **ingest both `parcel_number` and `pin` into `public.parcel`**, and in **M1 measure the normalized join rate of every source against `public.parcel` on each candidate key path**, then set **per-source thresholds in the `CityAdapter` from the measured baseline** — not a uniform 98%.
- **Gate ≠ halt.** A batch below its source threshold lands in `raw`/quarantine and **alerts**; it does not deadlock the nightly run. Expected historical misses (pre-subdivision 1974-era RTT accounts no longer in OPA) are counted and excluded from the live gate.
- **Geometry** (no lat/lng anywhere — coords live in `the_geom`): Carto adapters fetch via `&format=geojson` (or `ST_X/ST_Y`); the OPA **S3 CSV `the_geom` is WKT/EWKT text** → parse with `ST_GeomFromText/EWKT` into `geometry(...,4326)`. Validate `parcel.geom` non-null ratio ≈ 99.98% baseline; large drop blocks promotion.
- Schemas: `raw.*` (faithful landing, mostly transient), `public.*` (canonical+derived, anon-readable via GRANT), `app.*` (user data, RLS), `ops.*` (run logs, cursors, quarantine — **not** anon-exposed).
- Audit columns: `ingested_at`, `source_updated_at` where available.

### 3.2 Canonical tables (anon GRANT SELECT only)
- **`public.parcel`** — PK `parcel_pk`. + **`pin text`** (alt join key), `is_active bool default true`, `retired_at` (soft-retire on reload, never hard-delete). Cols: `address`, `zip`, `geom geometry(Point,4326)`, `market_value`, `sale_price`, `sale_date`, `year_built`, `beds`, `livable_area`, `category_code`, `zoning`, `owner_1`, `owner_2`, `mailing_address`, `mailing_city_state`, `state_code`, derived `is_out_of_state_owner`, `neighborhood_id`, `zip_id`, `tract_id`. Indexes: GIST(`geom`), btree(`zip`,`neighborhood_id`,`pin`).
- **`public.transfer`** (from `rtt_summary`) — `transfer_id` PK, `cartodb_id` (cursor), `parcel_pk` (nullable; **no physical FK** — high-volume historical, integrity via gate), `document_type`, `recording_date`, `total_consideration`, `cash_consideration`, `fair_market_value`, `common_level_ratio`, `grantors`, `grantees` (source is **plural**, free-text; mapped in adapter), derived `is_sheriff`, `is_distress_doc`, `is_estate_or_nonmarket`, `is_arms_length`, `price_to_assessment`. Indexes: btree(`parcel_pk`,`recording_date`,`cartodb_id`).
- **`public.permit` / `violation` / `complaint` / `case_investigation`** — `parcel_pk` (nullable, no physical FK), source id, type/code, status, dates. Indexes on `parcel_pk`+date.
- **`public.distress_inventory`** — union of `unsafe`/`imm_dang`/`demolitions` + `kind`.
- **`public.sheriff_listing`** — `listing_id` PK, `parcel_pk` (**nullable**), `raw_assessment_id` (preserve dirty source value), `sale_type` (mortgage|tax — **derived from which page**, not the SaleType column), `source_sale_type` (raw), `sale_status` (preview|postponed — **core vocab only**), `enrichment_status` (sold|stayed|null — Bid4Assets only), `sale_date`, `street`, `book_writ`, `source_url`, best-effort `opening_bid`,`judgment`,`attorney`,`plaintiff` (nullable), `scraped_at`.
- **`public.crime_incident` / `service_request`** — `geom geometry(Point,4326)`, `occurred_on`, `category`/`type`, **plus `tract_id`/`zip_id`/`neighborhood_id` stamped via point-in-polygon at ingest** (so aggregation is a GROUP BY, not a nightly full spatial join). Windowed ~10y. GIST(`geom`), btree(`occurred_on`, geo ids).

### 3.3 State history — change-logs with explicit baseline (supersedes CONCEPT §4/§6 "nightly snapshots" wording; goal — forward-accruing trends + alerts — unchanged)
- On **first observation** of each `(parcel_pk, field)`, write a **baseline row** (`old=NULL, new=current, changed_on=first_ingest_date`) so every series has a defined t0.
- **`public.parcel_change_log`** — `parcel_pk`, `field`, `old_value`, `new_value`, `changed_on`. **Reconstruction (documented):** point-in-time value = latest `new_value` with `changed_on ≤ target`. Powers value trends + "owner/value changed" alerts.
- **`public.delinquency_event` / `violation_event`** — derived by diffing successive nightly loads. **Caveat (documented):** nightly granularity — sub-night flip-flops aren't captured. `new_distress` alerts fire on **first-appearance-relative-to-the-parcel's-prior-event-history** (so a re-appearance after a clear still fires), not a pure net diff. Each event stores the standing flag values (`is_actionable`,`sheriff_sale`) on every load for audit.

### 3.4 Derived / refreshed nightly (after a source's load+promotion completes — never against a partial batch)
- **`public.distress_signal`** matview — UNIQUE(`parcel_pk`); `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- **`public.comp_candidate`** matview — UNIQUE on its grain; `CONCURRENTLY`.
- **`public.geo_metric`** — a **regular table, incrementally upserted** (NOT a full-recompute matview): `UNIQUE(geo_type,geo_id,period,metric)`; recompute only the current + trailing changed months nightly; deep-history event backfill computed once. Avoids the full nightly recompute over 14M+ rows and never blocks reads.
- **`public.geo_boundary`** — polygons per geo unit (zip, Azavea neighborhoods, census tracts); GIST(`geom`); loaded once.
- (CONCURRENTLY requires a one-time non-concurrent populate first; matviews carry **no RLS** — access is GRANT-only, §3.6.)

### 3.5 User data (`app.*`, RLS owner-only)
`app.profile` (`id`=`auth.uid()`), `app.subscription` (stripe_customer, status, current_period_end — **written only by the service_role webhook**), `app.saved_area` (kind polygon|canonical|radius → resolved to `geom geometry(Polygon,4326)`), `app.saved_lead` (parcel_pk, status enum, tags[], notes), `app.alert_subscription` (saved_area_id, trigger_types[], channel, frequency, **`last_sent_at`**), `app.alert_event` (parcel_pk, trigger_type, payload jsonb, created_at, read_at), `app.skiptrace_key` (vendor, `encrypted_key` — Vault; see §3.6/§6).

### 3.6 RLS + grant matrix (explicit & CI-tested)
| Relation | RLS | anon | authenticated | writer |
|---|---|---|---|---|
| `public.*` tables | ENABLE; `select using(true)` | GRANT SELECT only | GRANT SELECT only | service_role (worker) |
| `public.*` matviews / `geo_metric` | n/a (no RLS on matview) | GRANT SELECT | GRANT SELECT | worker |
| `app.*` | ENABLE; `using(user_id=auth.uid())` all CRUD | none | owner-only CRUD | owner + service_role |
| `app.skiptrace_key` | ENABLE owner-only; **REVOKE SELECT from anon+authenticated** | none | none (no direct select) | decrypt only in SECURITY DEFINER proxy |
| `ops.*` (ingest_run, cursors, quarantine) | ENABLE; deny | none | none | service_role only |
For every `public.*` table: `ENABLE ROW LEVEL SECURITY` + `REVOKE INSERT,UPDATE,DELETE … FROM anon,authenticated` + `GRANT SELECT`. The **worker writes as `service_role`** (RLS-bypassing). **CI security gate:** fail if anon/authenticated can write any `public.*`, can select `app.skiptrace_key.encrypted_key`, or if any exposed-schema relation lacks RLS/GRANT. `ops.ingest_run` (holds raw error text) lives in `ops.*`, never anon-readable.

---

## 4. Ingestion pipeline

### 4.1 Orchestration
- **GitHub Actions cron**, nightly (staggered after Philly's morning refresh; UTC). **Keep-alive must mutate the repo** (heartbeat-file commit / API issue-comment on a <60-day cadence) — the schedule trigger alone does NOT reset the 60-day idle auto-disable.
- **Liveness:** each successful run pings an external **healthchecks.io** monitor; it alerts on the *absence* of a run (the per-source failure webhook can't detect a run that never started). Fly.io ~$2/mo always-on worker is the documented fallback if Actions reliability proves inadequate.
- Worker steps (ordered): `normalize → load raw/staging → validate(per-source gate) → promote canonical (atomic) → diff→change-log/alerts → refresh derived → trigger tile build`. **Invariant:** diff/change-log and derived-refresh run only after that source's full batch is promoted — never against a partial/un-promoted load.
- **Resumability:** `ops.source_cursor` (`source`, `last_cartodb_id`/`watermark`, `rows_committed`, `run_id`, `updated_at`) committed every N pages; a run that dies mid-backfill resumes from it. Idempotent upserts on natural source id give re-run safety.
- **Page size:** explicit per source (e.g. 10,000 rows for RTT), bounded by the **~10 MB Carto client buffer** and **~30 s request timeout**. The 5.1M RTT backfill ≈ 255–510 pages — logged as a sanity target.
- `ops.ingest_run` log: source, timing, rows_in/promoted, per-key join rates, malformed_key_count, status, error.

### 4.2 Source adapters (v1)
| Source | Method | Cadence | Notes |
|---|---|---|---|
| OPA | **S3 bulk CSV** → `raw` staging → validate (row count within ±5% of ~583,617 **and** S3 `Last-Modified` newer than last run) → atomic diff vs canonical → promote. WKT geom parse. Soft-retire missing accounts. | nightly | Diff → `parcel_change_log`. Skip+alert on freshness/row-count fail (no phantom alerts). |
| RTT `rtt_summary` | Carto **keyset on `cartodb_id`** (`WHERE cartodb_id > $cursor ORDER BY cartodb_id LIMIT page`); one-time **backfill to 1974** (resumable, see M1); **incremental by `cartodb_id` watermark** (NOT `recording_date` — dates are non-unique and deeds arrive back-dated); **weekly full keyset re-sync** to heal gaps. | nightly + weekly | Comps spine. ~7-week source lag is normal (max `recording_date` lags); "zero new rows" ≠ failure. Derive flags on load. |
| L&I `permits`/`violations`/`complaints`/`case_investigations` | Carto keyset on `cartodb_id`, incremental | nightly | ~6M rows total — counts in the size budget. |
| `unsafe`/`imm_dang`/`demolitions` | Carto full (tiny) | nightly | → `distress_inventory`. |
| `real_estate_tax_delinquencies` | Carto full (54K) | nightly | Diff → `delinquency_event`; carries `sheriff_sale`,`is_actionable`. Health-check (undocumented table) → fallback to ArcGIS rollup + alert on 404. |
| `real_estate_tax_balances` | Carto full (684K) | nightly | Same health-check. |
| `incidents_part1_part2` (crime) | Carto keyset, **windowed ~10y** (~1.8M rows), stamp geo ids at ingest | nightly | Spatial. |
| `public_cases_fc` (311) | Carto keyset, windowed, filter "Information Request" noise, stamp geo ids | nightly | Spatial. |
| `business_licenses` | Carto full | weekly | Rental = `licensetype='Rental'`. |
| **Sheriff** | **Scrape** `phillysheriff.com/mortgage/` + `/foreclosure/` (cheerio; **honor robots `Crawl-delay: 10`**; assert `<thead>` columns before parse). Dirty-key handling (see below). Bid4Assets enrichment **behind a config flag OFF by default** in the public repo. | weekly | `sale_type` from page. `AssessmentID`→`parcel_pk` only for `^\d{9}$`; 10-digit → try as-is and trailing-9 (accept if exactly one parcel matches); alpha (e.g. `2502T0123`) → `parcel_pk` NULL + keep `raw_assessment_id`. Listing kept even when parcel_pk NULL. |
| Geo boundaries | One-time: Azavea neighborhoods (GitHub GeoJSON), ZIP, census tracts | once | `geo_boundary` (GIST). |

**Phase 2:** ArcGIS adapters (lead certs, rental suitability), ACS/Census demographics. *(v1 ingestion inputs are exactly: Carto, S3 bulk, phillysheriff scrape, one-time geo files. The §2 diagram marks ArcGIS as phase 2.)*

### 4.3 Per-source validation gate
Configured per source in `CityAdapter`: spatial-only (crime/311) **exempt** from parcel-join gate (validate `geom` not-null + point-in-city instead); RTT/historic on the **incremental slice** at its measured baseline (recent deeds ~98%+, historic legitimately lower and excluded); current-state (OPA, tax) at ~98%; sheriff alert-only, never drops a row. Also assert derived `is_out_of_state_owner` count ≈ ~37.8K baseline (alert on large deviation; derive from `state_code`, trimmed/upper).

---

## 5. Derived analytics specs

### 5.1 Transfer flags (on load; document_type literals verified live in Carto)
- `is_sheriff` = `document_type IN ('DEED SHERIFF','SHERIFF''S DEED')`.
- `is_distress_doc` = above + `('DEED OF CONDEMNATION','DM - LIS PENDENS','DEED LAND BANK','DEED - ADVERSE POSSESSION')`.
- **`is_estate_or_nonmarket`** = `grantors`/`grantees` match `ESTATE OF|EXECUTOR|EXECUTRIX|ADMINISTRATOR|ADMINISTRATRIX|TRUSTEE` **or** same-surname intra-family proxy, esp. with nominal consideration. (Recovers the verified "estate/quitclaim is not a document_type" correction.)
- `is_arms_length` = `document_type IN ('DEED','DEED MISCELLANEOUS','MISCELLANEOUS DEED')` AND `total_consideration > nominalFloor` AND NOT `is_distress_doc` AND NOT `is_estate_or_nonmarket`.
- `price_to_assessment` = `total_consideration / nullif(fair_market_value,0)` (CLR-derived FMR fallback = `common_level_ratio * assessed`). **Relabeled** from "price_to_fmr" — it is assessment-relative, a *diagnostic*, NOT the market benchmark. CI asserts each document_type literal matches ≥1 source row (fail loudly on a source rename).

### 5.2 Comps + value estimate (transparency-first)
- **Comp set:** `transfer` rows where `is_arms_length`, within radius (`ST_DWithin` on `parcel.geom`) OR same `neighborhood_id`; similar `beds` (±1), `livable_area` (±25%), `year_built` (±~15y), same broad `category_code`; within recency window.
- **Min-sample floor N≥5** with a **deterministic widening ladder** (recency 18→36 mo → radius rings to a max → drop year band → drop beds band); if still <N, render an explicit **"insufficient comps"** state, never a low-confidence number.
- **Outlier control:** trim `$/sqft` outside [p5,p95] (or >k·IQR) before distribution/estimate; surface trimmed count.
- **Estimate:** `est = median_$psf × livable_area` with visible adjustments; **null/zero `livable_area` → land branch** (price-per-lot / land-area). **Below-market** is judged against the **comps-derived expected value** (independent), not `price_to_assessment`.
- Each comp annotated with **why selected** (distance, similarity deltas). Unit-tested in `packages/core`.

### 5.3 Distress signals + composite
Each **raw signal** is individually toggleable + shown on the parcel page: `tax_delinquent` (by `total_due`/years), `actionable_sheriff_flag`, `open_violations` (count, hazardous-weighted), `unsafe_or_imm_dang`, `recent_complaints` density, `on_sheriff_list`, `out_of_state_owner`, `vacancy_proxy`, `below_market_last_sale`.
**Composite (explicit normalization):** each component → a **0–1 sub-score** via a documented transform (booleans→{0,1}; counts/dollar/density→percentile rank across the parcel population or a capped piecewise function with stated cap); `composite = Σ(weight_i · subscore_i)`, `Σweight_i = 1` → bounded [0,1]. Normalization functions + weights are **versioned config** in `packages/core` and unit-tested. The parcel page renders, per component: **`{component, raw_value, normalized, weight, contribution, source_url}`** (also the API response shape, §6). Labeled "one opinionated lens"; raw overlays always available.

### 5.4 Geo aggregates → `geo_metric` (two explicitly-labeled classes)
- **(a) Backfillable, event-derived** (true historical monthly series): median sale price, median `$/sqft` (arms-length), permit count/trend, crime rate, 311 density, sheriff-deed share. Assessment-vs-sale **gap is computed per-transaction at sale time** so its event leg is historical.
- **(b) Forward-accruing, state-derived** (start at first-ingest month): delinquency share, assessment level, open-violation share. UI (§7.1) labels these **"tracking since &lt;ingest start&gt;"** and handles the single-point/empty-trend case.

---

## 6. API / serving
- **PostgREST** for direct reads of canonical tables + matviews + `geo_metric` (anon, **GRANT SELECT** — matviews carry no RLS).
- **Next API routes** (auth/logic):
  - `GET /api/parcel/:pk` — deep-dive bundle (parcel + transfers + permits/violations + taxes + nearby crime/311 counts via stamped geo ids + distress decomposition in the §5.3 shape).
  - `GET /api/comps?pk=…` — comp set + distribution + estimate + widening/trim metadata.
  - `GET /api/scan?geo=&lens=&period=` — choropleth values + trend; **returns each metric's available `period` min/max** (so the UI time-control knows the range per lens).
  - `GET /api/leads?filters…` — scored, paginated; export/save require auth (login-gated, free).
  - `app` CRUD (auth): saved areas, saved leads, alert subs, skip-trace key.
  - **`POST /api/skiptrace/:pk`** — requires `authenticated` (monetization deferred to M8; the `subscription.status='active'` gate is dormant); resolves the vendor base URL from a **server-side allowlist keyed by the `vendor` enum** (never DB/user-controlled host); **decrypts the key only here (SECURITY DEFINER / service-context)**, calls the vendor, returns contact data to the session, **never persists the PII and never logs the key**; per-user rate-limit + daily cap; POST + same-origin/CSRF-protected.
  - **Stripe webhook** → `app.subscription` (**M8, deferred**): reads **raw body**, verifies `stripe.webhooks.constructEvent(rawBody, sig, signingSecret)` (reject on failure), **idempotent on event id**, runs as **service_role**; `app.subscription` has no anon/authenticated write grant. Built but not wired until monetization.
  - **Email digest** (§7.4): GitHub-Actions post-diff step (or Edge Function) queries new `alert_event` per `alert_subscription` since `last_sent_at`, renders, sends via **ZeptoMail**, advances `last_sent_at`.
- **Tiles:** parcels as **PMTiles on Supabase Storage** — a **single object rebuilt nightly** by `packages/tiles` after derived-refresh (a public, S3-compatible Storage bucket; uploaded via the existing `@aws-sdk/client-s3` with `forcePathStyle: true`), served via CDN + HTTP range to MapLibre (Supabase Storage honors range requests, so PMTiles works unchanged). Aggregate boundaries as small static GeoJSON/PMTiles. **No dynamic `ST_AsMVT` base map** (egress). Martin reserved for future dynamic needs.

---

## 7. Product surfaces (functional spec — UX/visual design deferred to the `impeccable` step)

> Data contracts + behaviors are fixed here; layout, visual language, interaction polish are the `impeccable` step's job.

### 7.1 Market scan (PRIMARY — map-first)
Multi-resolution ZIP→neighborhood→tract→parcel (PMTiles). Lens switcher (price&value / development / distress / livability) colors the active geo unit from `geo_metric`. Time control (range from `/api/scan` per-lens min/max; class-(b) lenses labeled "tracking since …"). Filter panel (type, value band, distress thresholds, owner-occupancy). Click geo→area metrics+trend; click parcel→deep-dive. Each lens has an inline "what/how/source" explainer.

### 7.2 Property deep-dive (underwrite)
Sections: assessment vs last sale; full sale history (arms-length/estate flagged); open permits/violations/cases; taxes owed + delinquency history; nearby crime/311 (counts+trend); comps + value estimate; distress decomposition (§5.3 shape). Every figure links to its **raw record**. Glossary tooltips.

### 7.3 Leads (scan→score→list + mini-CRM)
Build by filters + distress thresholds over city/saved area; results table with score + signals. **Mini-CRM:** save lead, status, tags, notes; BYO skip-trace button (uses user key, §6). **CSV export (login-gated, free):** explicit columns (`parcel_pk, address, owner, mailing, distress components+composite, key signals`), server-side **streamed** with a row cap, UTF-8 + RFC-4180; **skip-trace/contact PII is never included**. Auth required to save/export; anon can preview. (Export stays login-gated even while free — preserves the future paywall seam and discourages scraping; monetization deferred to M8.)

### 7.4 Saved areas + alerts
Define a farm: draw polygon / pick canonical neighborhood-ZIP / radius around a point → stored polygon. Triggers (new_transaction/new_development/new_distress/new_matching_lead) → **nightly email digest (ZeptoMail) + in-app feed** from `alert_event`. Digest: per-user aggregation bounded by `last_sent_at`; **List-Unsubscribe header + unsubscribe link (CAN-SPAM)**.

### 7.5 Accounts (free; monetization deferred to M8)
Supabase Auth. §7.3–7.4 + export + BYO skip-trace are **login-gated but free** for any authenticated user. Free = all read surfaces (anon) + all personalization/automation (authenticated). The Stripe low-flat-subscription seam (`app.subscription`, the entitlement check) is **built and dormant** — re-armed in **M8** when monetization is validated, by flipping the two `requireUser` gates back to `requireEntitlement`.

### 7.6 Education layer (cross-cutting)
v1 baseline = inline transparency (explainers + raw-record links + methodology pages + glossary). Guided paths + fuller KB post-v1.

---

## 8. Non-functional requirements
- **License/repo:** AGPL-3.0, public from commit 1. **Secret controls:** GitHub **secret scanning + push protection** on; **gitleaks/trufflehog as a required CI check** (a CI scan alone runs after push — push-protection is the real gate); **full-history scan on first publish**; incident path = rotate immediately. Secrets only in env / Actions secrets / Supabase Vault. `.env.example` (placeholders) + `SELF_HOST.md` (docker-compose: Postgres+PostGIS, worker, web).
- **Environment variables (inventory):** `.env.example` ships placeholders for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (pooled), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ZEPTOMAIL_TOKEN`, `SUPABASE_S3_ENDPOINT`/`SUPABASE_S3_REGION`/`SUPABASE_S3_ACCESS_KEY_ID`/`SUPABASE_S3_SECRET_ACCESS_KEY`/`SUPABASE_STORAGE_BUCKET`/`SUPABASE_STORAGE_PUBLIC_BASE_URL` (Storage S3 access keys, minted in Project Settings → Storage → S3 Access Keys — distinct from the anon/service_role keys), `HEALTHCHECKS_URL`, `KEEPALIVE_TOKEN`, and the `SUPABASE_VAULT` key id for decrypting BYO skip-trace keys. (Carto needs no key; the OPA S3 bulk is public.) Track name · owner · required? · storage location for each.
- **Backup posture (decided for v1):** accept Supabase **daily backups / 7-day RPO**; **skip PITR (+$100)** for now. The change-log history tables (§3.3) are the one irreplaceable asset and are protected by the §4.1 liveness dead-man's-switch (alerts on a missed run); revisit PITR post-revenue.
- **Cost (corrected):** **~$45/mo baseline** = Supabase Pro **$25** + Vercel Pro **$20** (Hobby forbids commercial/payment use). Tiles ride on the existing Supabase Pro plan (100 GB storage + 250 GB egress included; $0.09/GB egress beyond) — no separate object-store vendor; heavy public tile traffic shares the Supabase project's egress with the warehouse. GitHub Actions free (public repo), ZeptoMail free/cheap tier. *Conditional:* Supabase **Small** compute (+$15) if nightly refresh strains Micro; **PITR (+$100)** only if chosen (else accept daily-backup/7-day RPO — decided in M0). The deferred subscription price (§11) is set against this true floor.
- **DB size budget (per-table tally, replaces the old 2–4 GB line):** RTT 5.1M + L&I ~6M + crime ~1.8M (post-10y window) + 311 (windowed) + tax_balances 684K + business_licenses 431K + parcel 584K (GIST geom) + change-logs + `geo_metric` ≈ tens of millions of rows; budget against Pro 8 GB with overage at $0.125/GB. **`raw.*` = land-transform-discard** for the huge sources (retain raw only for the scraper where re-parsing matters). M1/M3 DoD asserts on-disk size.
- **Performance:** scan choropleth <1s; deep-dive <1.5s; comps <1.5s; map base from CDN PMTiles. Non-blocking refreshes (CONCURRENTLY / incremental `geo_metric`).
- **Skip-trace threat model:** vendor keys encrypted at rest (protects backups/disk); decrypted only inside the server-side proxy at call time; a proxy-role compromise would expose keys in use — mitigated by least-privilege grants, no key logging, short-lived in-memory use. CONCEPT "zero legal exposure" → restated: **"liability for vendor contract/credentialing/permissible-purpose sits with the user; platform exposure sharply reduced."** Require a **per-user attestation** (lawful real-estate outreach only; no FCRA-regulated use) before enabling skip-trace.
- **Portability:** `CityAdapter` (§2.1); CI grep gate on Philly literals outside `packages/core/adapters/`.
- **Quality gates / test fixtures:** CI = typecheck + lint + unit tests + migration check + the security assertions (§3.6) + the literal/portability greps. **`norm_parcel` fixtures** (numeric `12345`→`000012345`; dashed string; `parcel_id_num` decoy must NOT yield a valid join; >9-digit → null+quarantine; null/empty→null). **Comps + scoring** golden cases. **Per-source golden CSV** + expected join-rate baselines for the gate. Validation-join sample size + block-on-fail defined.

---

## 9. Build milestones (ingestion-first; each has a Definition of Done)

**M0 — Foundations.** Monorepo + AGPL + secret scanning/push-protection + gitleaks CI + `.env.example`; Supabase Pro + PostGIS; schemas `raw/public/app/ops`; `CityAdapter` skeleton + philadelphia stub; **backup posture decided & documented** (PITR vs 7-day RPO). *DoD:* repo public, CI green (incl. security + portability greps), empty DB migrated, backup decision recorded.

**M1 — Ingestion core (do first).** `norm_parcel` + quarantine + fixtures; ingest OPA (S3, staging+freshness gate, WKT geom) → `parcel` (with `pin`, soft-retire); **measure per-source join rates on each key path, set thresholds**; L&I + tax + crime/311 (windowed, geo-stamped) + licenses; `ops.ingest_run`/`source_cursor`; per-source gate (quarantine, not halt); GitHub Actions cron + repo-mutating keep-alive; **healthchecks.io liveness**. *DoD:* nightly run green, per-source join rates meet measured baselines, history accruing (`parcel_change_log` baseline rows present), liveness alert verified, on-disk size within budget.

**M1a — RTT backfill.** One-time `rtt_summary`→1974 via `cartodb_id` keyset, **resumable across Actions runs (6h cap, chunked)**; derive flags incl. `is_estate_or_nonmarket`. *DoD:* `transfer` row count reconciled to Carto `count(*)` (±0.5%) before comps depend on it.

**M2 — Sheriff scraper.** phillysheriff core → `sheriff_listing` (page-derived `sale_type`, dirty-AssessmentID handling, `<thead>` assertions, crawl-delay); Bid4Assets enrichment behind OFF-by-default flag → `enrichment_status`. *DoD:* weekly run populates current listings, joins clean rows, keeps NULL-parcel rows, tolerates enrichment failure.

**M3 — Derived analytics.** `distress_signal` (raw + normalized composite, decomposable, versioned) + `comp_candidate` (CONCURRENTLY, unique indexes); comps + value estimate (`core`, unit-tested incl. small-sample/outlier/land branch); incremental `geo_metric` (classes a/b); `geo_boundary` (GIST). *DoD:* derived refresh completes within cron budget on Micro (else Small), non-blocking; scoring/comps tests pass; geo_metric per zip/neighborhood/tract with correct class labeling.

**— `impeccable` UX exploration here —** (fed by real M3 data shapes + the §5.3/§6 response contracts).

**M4 — Serving + map.** PMTiles build (single object/night, after refresh) → Supabase Storage; MapLibre multi-res map + 4 lenses + time control + filters; PostgREST/Next read APIs. *DoD:* scan interactive across zooms, all 4 lenses, single-object tile write verified.

**M5 — Property deep-dive.** Bundle endpoint + page; raw-record links; glossary tooltips. *DoD:* any parcel renders full underwrite view with sourced figures + distress decomposition.

**M6 — Leads + mini-CRM.** Scored leads query; results table; save/tag/note/status; **CSV export (spec'd, no PII)**; BYO skip-trace proxy (auth+rate-limit+allowlist+attestation). *DoD:* list buildable, savable, exportable; skip-trace works with a user key and leaks no key/PII.

**M7 — Accounts + alerts (free).** Supabase Auth → fill in `getUserId()` (the `lib/auth.ts` seam), dropping the dev seam; that lights up the (now free, login-gated) CSV export + mini-CRM save + skip-trace. Saved areas (3 modes); alert diff → `alert_event` → **nightly ZeptoMail digest (with unsubscribe / CAN-SPAM) + in-app feed**. **No Stripe.** *DoD:* sign in → save area → receive a real-change digest; unsubscribe works; skip-trace works with a user key and leaks no key/PII.

**M8 — Monetization (deferred, when validated).** Stripe low-flat sub + **verified webhook** (raw body, `constructEvent`, idempotent on event id, service_role write to `app.subscription`); flip the two free gates back to `requireEntitlement` (the dormant seam is already in place). Stripe keys needed. Price set against the ~$45/mo floor (§11). *DoD:* subscribe → entitlement unlocks the gated surfaces; forged webhook rejected.

**Cross-cutting:** transparency/education hooks + methodology pages + glossary throughout.

---

## 10. Risks & mitigations
| Risk | Mitigation |
|---|---|
| RTT/OPA join far below assumption | Ingest `pin`; measure per-source; quarantine+alert (not halt); exclude historical misses. |
| **History silently stops accruing** (cron auto-disable / missed runs) — the one fatal, irrecoverable failure | Repo-mutating keep-alive + external healthchecks.io dead-man's-switch alerting on run *absence*; Fly.io fallback. |
| Undocumented tax tables removed from Carto | Health check + fallback to ArcGIS rollups + alert. |
| Sheriff/Bid4Assets structure change | `<thead>` assertions, skip-on-mismatch, weekly cadence, enrichment OFF by default. |
| DB exceeds 8 GB | Land-transform-discard raw; window crime/311; incremental geo_metric; roll up old periods; size DoD. |
| Carto pagination row loss | Keyset on `cartodb_id`; weekly full re-sync; reconcile counts. |
| Secret leak in public repo | Push protection + gitleaks CI + history scan + rotate-on-leak. |
| Skip-trace key/PII exposure | Decrypt only in proxy; REVOKE select; no logging; no persist; attestation. |
| Distress composite read as "truth" | Always show raw signals + full decomposition; bounded [0,1]; labeled one lens. |

## 11. Deferred / open (not v1 blockers)
- Subscription **price point** (set against the ~$45/mo floor before M8 — monetization is deferred).
- Distress composite **weights + normalization caps** (documented defaults in M3; tunable).
- First BYO skip-trace vendors (BatchData/REISkip/Endato).
- Condo **unit dimension** on `parcel` — add only if M1 histograms show unit-suffixed ids in an ingested key column.
- ArcGIS lenses, ACS demographics, guided learning paths — phase 2.
- Integrated paid skip-trace — only via a future reseller addendum.

## 12. Glossary (also powers the education layer)
OPA (parcel id/assessments) · `pin` (alternate OPA parcel identifier; better RTT join) · L&I (permits/violations) · RTT (transfer dataset = deeds/sales) · CLR (Common Level Ratio) · Sheriff sale (foreclosure/tax auction) · Lis pendens (pending-foreclosure notice) · Arms-length (open-market sale between unrelated parties) · Homestead (owner-occupied exemption) · `cartodb_id` (Carto's stable unique row key — pagination cursor).
