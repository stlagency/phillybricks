# Bandbox — Philadelphia residential real-estate intelligence
## Consolidated Shared-Understanding Brief (v2)

**Status:** Product scope + architecture locked via interview. One open decision (skip-trace, §8). This brief is the input to a separate implementation plan.
**Date:** 2026-06-18. **Working dir:** `/Users/aaroncohen/CLAUDEMAXING/cw_Philly` (greenfield, empty). **Supabase org:** STL Agentic (no Philly project yet — to be created).

All numbers below were verified against live endpoints (Carto SQL API, ArcGIS, S3, phillysheriff.com) on 2026-06-17/18, not taken from the original concept doc.

---

## 1. Corrected factual baseline (what reality says vs. the original doc)

### Refuted / corrected premises
- **"Must warehouse because Carto times out" — FALSE as stated.** Filtered comps return in ~0.2s, a citywide distress histogram over all 580K parcels in ~0.75s, radius comps in ~0.43s. The only failure is unbounded `SELECT *` (a 10 MB *client* buffer, not a server cap). **The warehouse IS justified — but by the need for history/change-detection, not by timeouts.**
- **"AIS is the join glue" — FALSE for ingest.** Every core table already ships `opa_account_num` or a parcel number, so joins are key-based. AIS is gated (email-ticket, "internal use only," no batch endpoint) and is at most an optional query-time fallback for messy free-text address input. **Not a build dependency.**
- **"Philadelphia has no MLS" — FALSE.** Bright MLS covers Philly. Correct pitch: *off-market/distressed never hits MLS, and MLS comps are gated to licensed agents* — not "there is no MLS."
- **"Estate/quitclaim transfers" is not a readable field.** `rtt_summary.document_type` has no QUIT/ESTATE/EXECUTOR values. Must be **derived** (name regex like `ESTATE OF`/`EXECUTOR` + nominal consideration).
- **No `lat`/`lng` columns** anywhere — coordinates live only in `the_geom` (PostGIS). Use `ST_X`/`ST_Y` or `format=geojson`.

### The data spine (verified)
| Role | Table / source | Rows | Key | Notes |
|---|---|---|---|---|
| Parcel master | `opa_properties_public` (Carto) | **583,617** | `parcel_number` | 73 cols; nightly; `the_geom` 99.98% populated; pre-baked **S3 CSV ~303 MB** refreshed nightly (`opendata-downloads.s3.amazonaws.com/opa_properties_public.csv`). Owner + full mailing block ⇒ out-of-state detection (~37.8K non-PA). |
| Transactions/comps | `rtt_summary` (Carto) | **5,100,743** | `opa_account_num` | Back to **1974**. Price, transfer tax, parties, dates. `document_type`: `DEED` 1,092,370 (arms-length base), `DEED SHERIFF` 69,698 + `SHERIFF'S DEED` 18,165 (match BOTH), `DEED OF CONDEMNATION` 8,356, `DM - LIS PENDENS` 1,668, `DEED LAND BANK` 5,200. No arms-length flag — derive. |
| Permits | `permits` (Carto) | 923,297 | `opa_account_num` | Daily. `parcel_id_num` is an L&I-internal decoy — NOT OPA. |
| Violations | `violations` (Carto) | 1,986,220 | `opa_account_num` | Daily. + `complaints` 1,034,475, `case_investigations` 2,073,671. |
| Distress inventory | `unsafe` 3,130 / `imm_dang` 132 / `demolitions` 14,187 (Carto) | — | `opa_account_num` | Daily. |
| Tax delinquency | `real_estate_tax_delinquencies` (Carto) | **54,401** | `opa_number` (numeric) | Has `sheriff_sale` Y/N + `is_actionable`. Ready-made distress signal. Undocumented table — monitor. |
| Tax balances | `real_estate_tax_balances` (Carto) | 683,926 | `parcel_number` (numeric) | Undocumented table — monitor. |
| Crime | `incidents_part1_part2` (Carto) | **3,555,640** | spatial only | Daily, 2006→. PostGIS point-in-polygon/radius. |
| 311 | `public_cases_fc` (Carto) | **5,819,604** | spatial only | ~56% "Information Request" noise to filter. |
| Licenses | `business_licenses` (Carto) | 431,302 | parcel + spatial | `licensetype='Rental'` = 287,409. |
| Lead certs | `lhhp_lead_certifications` (**ArcGIS**) | 585,265 | `opa_account` | Needs ArcGIS adapter. |
| Rental suitability | `CERT_RENTAL_SUTBLTY` (**ArcGIS**) | 786,442 | — | Needs ArcGIS adapter. |
| Neighborhoods | Azavea GeoJSON (**GitHub**) | ~150 | polygon | Static file, not a feed. |
| Demographics | ACS (**census.gov API**) | — | tract | Carto only has 2010 tract polygons. |

### Parcel-key minefield (the #1 ingest hazard)
Three names for the same OPA id with **type mismatches**: `opa_account_num` (string; RTT + L&I), `parcel_number` (numeric; OPA, tax_balances), `opa_number` (numeric; tax_delinquencies). L&I also carries a **decoy** `parcel_id_num` (L&I-internal, NOT OPA). Naive joins silently drop rows. → **First ingest task: a canonical parcel-key normalizer (cast + zero-pad to 9 chars) with a spot-check validation join, before anything joins to anything.**

### Licensing
Commercial reuse/resale is **permitted** (Executive Order 1-12 mandates unrestricted reuse). Guardrails: don't imply City endorsement / use City marks; pass through the "as-is, no warranty" + hold-harmless disclaimer. One-line counsel sign-off advisable, not blocking.

---

## 2. Locked product decisions

| # | Decision | Choice |
|---|---|---|
| Audience | Who/what | Productized but **open-source, low-markup, community, educational** — "educate as much as provide value." Not a moat play. |
| Core UX | Primary surface | **Market scan** (map-first) is the front door; **lead-finding** and **underwriting** are drill-downs. Funnel: city → neighborhood → property. |
| Time | History | **History + alerts needed** → ingest/warehouse (justified by history, not timeouts). |
| Education | Mode | **Transparency-first** (inline "show the work": methodology, data source, link to raw record), with guided paths + reference/glossary as follow-ons. |
| Geography | Scope | **Philly now, behind a clean adapter seam** — second city is additive, not a rewrite. |
| Map unit | Granularity | **Multi-resolution, zoom-driven**: ZIP/region → neighborhood → tract → parcels. |
| Map lenses | v1 must-haves | **All four**: Price & value trends · Development momentum · Distress & risk · Livability (crime + 311). |
| Accounts | Access model | **Open anonymous browse/scan/underwrite**; accounts gate alerts, saved areas, leads workspace, exports. |
| Distress | Model | **Raw signal overlays + an optional, fully decomposable composite** (no black box). |
| Sheriff | Forward auctions | **Scraper IN v1** (see §6 — easy core + optional fragile enrichment). |
| Skip-trace | Owner contact | **BYO-key only for v1** — users connect their own vendor key; we orchestrate, never resell. Integrated resale deferred (needs a reseller addendum + per-user credentialing). |
| Monetization | Money flow | **Deferred to M8.** Power features (alerts/saved-areas/leads/exports) are **login-gated but free** in v1; the low-flat-subscription seam (Stripe + `app.subscription`) is built and dormant, re-armed when validated. Free browsing throughout. |
| Leads | Workspace | **Mini-CRM**: saved leads + notes/tags/status + CSV export (login-gated, free; paywall seam dormant → M8). |
| Valuation | Underwrite | Comps **+ transparent rule-based estimate** (e.g. neighborhood median $/sqft × livable area, adjustments shown). No ML AVM. |
| Repo | OSS posture | **AGPL, public from day 1** ⇒ clean secret hygiene from commit 1; `.env.example` + documented self-host path. |

---

## 3. Resolved external research

### 3a. Sheriff sales (forward auctions)
- **Canonical 2026 source:** `phillysheriff.com/mortgage/` (mortgage foreclosure, 1,392 rows) + `phillysheriff.com/foreclosure/` (tax/lien, 1,060 rows). **Server-rendered Ninja Tables HTML** — no headless browser.
- **Fields per row:** ID, BooknWrit, **AssessmentID (= 9-digit OPA parcel number — joins cleanly to `opa_properties_public`, no geocoding)**, Street, SaleType, SaleStatus (Preview/Postponed), SaleDate.
- **Enrichment** (opening bid, judgment, deposit, attorney, plaintiff, ward, court case #, sold/stayed): only on **Bid4Assets** `bid4assets.com/auction/index/{id}` — IIS UA bot-filter (403s default crawlers), captcha present. Curl-able with a browser UA but **fragile; scrape sparingly**, match on Book/Writ or OPA.
- **v1 decision:** scrape the **phillysheriff.com core** (reliable, OPA-keyed); treat **Bid4Assets enrichment as best-effort**, not a hard dependency. Re-scrape weekly (monthly sale churn + postponements); validate the `<thead>` column order each run.

### 3b. Skip-trace / owner contact
- **No major vendor's standard ToS permits a self-serve SaaS to resell phone/email.** BatchData, TLOxp, LexisNexis, IDI all prohibit third-party redistribution absent a signed reseller addendum. Real-estate investor outreach is **not** an enumerated GLBA/DPPA permissible purpose; credentialed vendors require per-end-user permissible-purpose certification + audits — incompatible with frictionless signup. FTC fined Spokeo **$800K** for API-selling profiles without policing downstream use.
- **Recommendation:** **BYO-key as default** — each user connects their own BatchData/REISkip/Endato key; contract + liability sit with them, we orchestrate only. Integrated resale is only lawful via a **signed reseller addendum** (realistically BatchData/Endato/Tracerfy) **with credentialing pass-through** that removes true self-serve — defer to post-launch if ever.
- **Per-lookup economics (for BYO):** BatchData ~$0.07–0.18/record; REISkip ~$0.15/skip; Endato ~$0.10–0.25/match.

### 3c. Tiling + ingestion architecture
- **Base map:** pre-generate **PMTiles via tippecanoe** (~23 MB for ~758K parcel/building features, ~54s build), store as a single file on **Supabase Storage** (S3-compatible; rides the existing Supabase Pro plan — 100 GB storage + 250 GB egress included, $0.09/GB egress beyond), serve to **MapLibre** via HTTP Range requests. MapLibre renders PMTiles ~2× faster than deck.gl; reserve **deck.gl for advanced overlays** only.
- **Aggregates:** materialized views per geography (ZIP ~48, neighborhood ~150, tract ~1,300 rows) → ship boundaries as tiny static GeoJSON/PMTiles.
- **Avoid:** dynamic Supabase `ST_AsMVT` as the base map ($0.09/GB uncached egress). Use **Martin** (fastest) or pg_tileserv only for dynamic per-parcel tiles if ever needed.
- **Heavy ingestion orchestration:** **GitHub Actions cron** (free minutes on public repos; 6 h job cap; UTC-only; 10–30 min start delays; auto-disables after 60 days idle → add a keep-alive) running the S3 bulk load + ArcGIS pagination + sheriff scraper, writing to Supabase Postgres. Always-on worker fallback: Fly.io ~$2/mo, Railway $5/mo, Render $7/mo.
- **DB sizing/cost:** Supabase **Pro required** ($25/mo, 8 GB — free tier auto-pauses after 7 days + 500 MB cap). Event rows RTT 5.1M + crime 3.5M + 311 5.8M ≈ 14.4M ≈ 2–4 GB indexed; **window crime/311 + roll up snapshots** to stay under 8 GB.
- **Total infra ≈ $25/mo** (Supabase Pro, which also covers tile storage/egress — 100 GB / 250 GB included) + GitHub Actions free (public repo) + Vercel hobby/pro + Stripe usage fees. Fits low-markup.

---

## 4. v1 scope

**IN:**
- Nightly **ingestion pipeline** → Supabase Postgres/PostGIS: canonical parcel-key normalizer; OPA (S3 bulk + nightly); `rtt_summary` backfill to 1974 + incremental; L&I (permits/violations/complaints/unsafe/imm_dang/demolitions); tax delinquency + balances; crime + 311 (windowed ~10 yr); business/rental licenses; **nightly state snapshots → history tables** (so trends/alerts start accruing immediately).
- **Multi-resolution map** (ZIP→neighborhood→tract→parcel) with **4 lenses** (price & value, development momentum, distress & risk, livability).
- **Distress** = raw signal overlays + an optional transparent composite.
- **Property deep-dive (underwrite):** assessment vs. last sale, full sale history, open permits/violations, taxes owed, nearby crime/311, RTT comps + transparent rule-based value estimate — every figure links to its raw record.
- **Leads (scan→score→list)** + **mini-CRM workspace** (saved leads, notes/tags/status, CSV export).
- **Accounts** (Supabase Auth) gating: **saved target areas** (draw polygon / pick canonical / radius), **alerts** (4 triggers: new transactions, new development, new distress, new matching leads → nightly email digest + in-app), leads workspace, exports.
- **Sheriff scraper** (phillysheriff.com core; Bid4Assets enrichment best-effort).
- **Power features are free for authenticated users in v1**; the low-flat-subscription seam (Stripe) is dormant, deferred to **M8**.
- **BYO-key skip-trace** (optional): users connect their own contact-data vendor key; we orchestrate only, never resell.
- **Transparency-first education**: inline explainers/methodology, raw-record links, glossary.
- **AGPL public repo**, clean secrets, `.env.example`, self-host docs, Philly behind an adapter seam.

**OUT / deferred:**
- Integrated paid skip-trace resale (requires a reseller addendum + per-user credentialing; deferred post-launch).
- ArcGIS-sourced lenses: lead-cert + rental-suitability (phase 2).
- Demographics/ACS overlay (phase 2 context panel).
- Rental/landlord lens (phase 2).
- ML AVM (off-ethos).
- Actual second city (adapter seam only in v1).
- Guided learning paths + full reference layer beyond the v1 transparency baseline.

---

## 5. Target architecture

```
Carto SQL ─┐
ArcGIS ────┼─► GitHub Actions cron (nightly)
S3 bulk ───┤      • parcel-key normalizer (FIRST)
phillysheriff scrape ┘   • upserts + nightly state snapshots
                              │
                              ▼
                 Supabase Postgres + PostGIS (Pro)
                   • canonical `parcel` + raw tables
                   • history/snapshot tables
                   • materialized views: comps, geo aggregates,
                     distress signals + composite, momentum
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                 ▼
      tippecanoe → PMTiles   PostgREST /      Supabase Auth
      → Supabase Storage     Next API         ZeptoMail · Stripe (M8)
              │               │
              ▼               ▼
        MapLibre (base) + deck.gl (overlays) · Next on Vercel
        market scan · property deep-dive · leads/mini-CRM · alerts
```

---

## 6. Build sequencing (ingestion-first — every night uncaptured is history lost)

0. **Foundations:** repo + AGPL + secret hygiene + adapter-seam skeleton; create Supabase Pro project; enable PostGIS.
1. **Ingestion (do first):** parcel-key normalizer + validation join → OPA (S3) → `rtt_summary` (backfill + incremental) → L&I set → tax delinquency/balances → crime/311 (windowed) → licenses → sheriff scraper → nightly snapshot tables. Wire GitHub Actions cron. **Let it run to start accruing history.**
2. **Derived analytics:** comps view, geo aggregates (materialized), distress signals + composite, $/sqft distributions, momentum, change-detection diffs for alerts.
3. **Serving + map:** PMTiles build job → Supabase Storage; MapLibre multi-res map + 4 lenses; PostgREST/Next API.
4. **Property deep-dive** + comps + transparent rule-based estimate.
5. **Leads** scan→score→list + mini-CRM.
6. **Accounts + saved areas + alerts (digest)** — login-gated but free; subscription (Stripe) deferred to **M8**.
7. **Transparency/education layer + glossary**, woven across surfaces.

---

## 7. Cost envelope (low-markup check)
Supabase Pro **$25/mo** + **Vercel Pro $20/mo** (Hobby forbids commercial/payment use) · tiles on Supabase Storage (included in Pro: 100 GB storage + 250 GB egress) · GitHub Actions **free (public repo)** · ZeptoMail **free/cheap** · Stripe usage fees. ⇒ baseline **~$45/mo**. Conditional: Supabase Small compute +$15 if nightly refresh strains Micro; PITR +$100 only if chosen. Scales with DB size (window/roll-up to control).

> **Engineering specs are superseded by `PRD.md` (v1.1)** on technical detail. Notably: history is captured as **change-logs, not full nightly snapshots** (same goal — forward-accruing trends + alerts); RTT joins ~60% on `parcel_number` so we also ingest OPA `pin` and set **empirical per-source join gates**; Carto pagination keys on `cartodb_id`. This brief remains the source of truth for *product scope*; the PRD governs *how*.

---

## 8. RESOLVED — skip-trace posture
**Decision: BYO-key only for v1.** Users connect their own contact-data vendor key (BatchData/REISkip/Endato); we provide orchestration UI only and never resell — so contract, credentialing, and GLBA/DPPA/FCRA liability sit with the user. Zero legal exposure; fits AGPL/low-markup/community. Integrated paid resale is deferred post-launch and would require a signed reseller addendum + per-user credentialing pass-through (BatchData/Endato/Tracerfy are the only realistic paths).
