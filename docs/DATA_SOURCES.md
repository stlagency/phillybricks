---
name: philly-open-data-facts
description: "Verified Philadelphia open-data landscape for the real-estate tool — tables, row counts, endpoints, join-key hazards, sheriff/skip-trace/tiling findings. Expensive to re-derive."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66da300f-307f-40c5-bd4f-3a311e7b7364
---

Ground-truthed against live endpoints 2026-06-17/18 for the Philly real-estate intelligence tool. Full detail in `/Users/aaroncohen/CLAUDEMAXING/cw_Philly/CONCEPT_v2_shared_understanding.md`. See [[philly-tool-v1-decisions]].

**Carto SQL API** `https://phl.carto.com/api/v2/sql?q=<urlenc SQL>` is fast, free, unauthenticated. Filtered/aggregated queries run sub-second even over millions of rows; only unbounded `SELECT *` fails (10 MB *client* buffer, not a server cap). So a warehouse is NOT needed for timeouts — it's needed only for **history/change-detection** (Carto serves "now" only).

**Core tables (Carto):** `opa_properties_public` 583,617 parcels (key `parcel_number`, 73 cols, `the_geom` only — no lat/lng; nightly S3 dump `opendata-downloads.s3.amazonaws.com/opa_properties_public.csv` ~303 MB) · `rtt_summary` 5.1M transfers back to 1974 (key `opa_account_num`; comps spine; `document_type` flags `DEED SHERIFF`+`SHERIFF'S DEED`, condemnation, lis-pendens, land-bank; arms-length must be DERIVED) · `permits` 923K · `violations` 1.99M · `complaints` 1.03M · `case_investigations` 2.07M · `unsafe` 3,130 · `imm_dang` 132 · `demolitions` 14,187 · `real_estate_tax_delinquencies` 54,401 (key `opa_number`, has `sheriff_sale` flag) · `real_estate_tax_balances` 683,926 (key `parcel_number`) · `incidents_part1_part2` (crime) 3.56M spatial-only · `public_cases_fc` (311) 5.82M spatial-only (~56% noise) · `business_licenses` 431K.
**Not on Carto:** lead certs + rental-suitability = ArcGIS; neighborhoods = Azavea GitHub GeoJSON; ACS = census.gov API.

**PARCEL-KEY HAZARD:** same OPA id appears as `opa_account_num` (string), `parcel_number` (numeric), `opa_number` (numeric); L&I also has a DECOY `parcel_id_num` (not OPA). Build a normalizer (cast + zero-pad to 9 chars) as the FIRST ingest task or joins silently drop rows.

**AIS API:** gated (email-ticket, "internal use only," no batch endpoint). NOT needed for ingest (tables already carry parcel keys); at most an optional query-time fallback for free-text address input.

**Sheriff sales (forward auctions):** NOT in open data. Source = `phillysheriff.com/mortgage/` + `/foreclosure/` (server-rendered Ninja Tables HTML; row `AssessmentID` = 9-digit OPA → clean join). Bid/judgment enrichment only on Bid4Assets (anti-bot, fragile).

**Skip-trace:** no vendor's standard ToS permits self-serve SaaS resale of owner phone/email (GLBA/DPPA credentialing cascade; FTC fined Spokeo $800K). BYO-key is the clean path.

**Tiling/infra:** PMTiles (tippecanoe) on Cloudflare R2 → MapLibre via HTTP range; avoid dynamic `ST_AsMVT` as base map (egress cost). Heavy ingestion via GitHub Actions cron (free on public repo) → Supabase **Pro required** ($25/mo, 8 GB; free tier auto-pauses + 500 MB cap). Window crime/311 to stay under 8 GB. **Vercel Pro required ($20/mo) — Hobby forbids commercial/payment use.** Baseline infra **~$45/mo** (Supabase Pro + Vercel Pro). RTT→OPA joins only ~60% on `parcel_number`; also ingest OPA `pin`. Carto keyset pagination must use `cartodb_id` (recording_date is non-unique).

**License:** Philly open data permits commercial reuse/resale with disclaimers (no City endorsement/marks).
