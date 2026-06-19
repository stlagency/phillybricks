ultracode

You are kicking off the v1 build of **Bandbox** — an open-source (AGPL), transparency-first Philadelphia residential real-estate market-intelligence tool. Greenfield repo at `/Users/aaroncohen/CLAUDEMAXING/cw_Philly`. You have NO prior conversation context; the planning docs ARE the context.

## STEP 0 — Read these first, in full, before doing anything else
1. `HANDOFF.md` — orientation + status + human pause-points.
2. `PRD.md` — the **engineering source of truth** (v1.1, adversarially hardened). Governs HOW everything is built (data model, ingestion adapters, API, milestones M0–M7 with Definitions of Done).
3. `CONCEPT_v2_shared_understanding.md` — locked product scope + the off-market public-record thesis. Product source of truth; PRD wins on technical detail.
4. `design/DESIGN.md` + `TOKENS.css` — the **visual source of truth**: the unified design system **"The Survey Table, Warmed."** Skim the rendered mockups `design/mockups/01-market-scan.html` + `02-property-deep-dive.html`.
5. `docs/DATA_SOURCES.md` — verified live-data facts (table names, row counts, endpoints, the parcel-key hazard).
6. `BRAND.md` — brand voice + the PHILLY/BRICKS logo (now folded into DESIGN.md; still authoritative for voice/logo).
Project memory (`philly-open-data-facts`, `philly-tool-v1-decisions`) loads automatically.

## GOAL
Build Bandbox v1 per those docs. Pipeline the PRD's milestones **M0 → M7** (PRD §9), each with its Definition of Done. The design language is settled — implement the surfaces against **"The Survey Table, Warmed"** verbatim (`design/DESIGN.md` + `TOKENS.css`).

## APPROACH — ultracode multi-agent workflow, INGESTION-FIRST
Drive this as an ultracode workflow that pipelines the milestones. Be **ingestion-first** (PRD Principle §0.6, §9): stand up **M0 foundations** then **M1 ingestion core** and let the nightly run start immediately — state history (change-logs `public.parcel_change_log` / `delinquency_event` / `violation_event`) only accrues forward and is the one irrecoverable asset (PRD §10 fatal risk; protected by the §4.1 liveness dead-man's-switch).

Insert **adversarial verification gates** (a skeptic agent that tries to break it, with golden fixtures — not happy-path demos) at the four correctness-critical points:
- **`norm_parcel` normalizer** (PRD §3.1): 9-digit assert; 1–8 → zero-pad to 9; >9 or empty → NULL + quarantine to `ops.parcel_key_quarantine` + `malformed_key_count`. Fixtures: `12345`→`000012345`; dashed string; the L&I `parcel_id_num` decoy must NOT yield a valid join; >9-digit → null+quarantine; null/empty → null. NEVER join on `parcel_id_num`.
- **Per-source join-rate gates** (PRD §3.1/§4.3): RTT→OPA is empirical (~60% on `parcel_number`) — ingest BOTH `parcel_number` and OPA `pin`; in M1 MEASURE the normalized join rate per source per key path and set per-source thresholds in the `CityAdapter` from the measured baseline (not a uniform 98%). Gate ≠ halt: below-threshold batches quarantine + alert, never deadlock; spatial sources (crime/311) are exempt from the parcel-join gate.
- **Distress-score math** (PRD §5.3): each sub-score normalized 0–1 via a documented transform; `composite = Σ(weightᵢ·subscoreᵢ)`, Σweight=1, bounded [0,1]; weights + normalization are versioned config in `packages/core`, unit-tested; parcel page + API both emit `{component, raw_value, normalized, weight, contribution, source_url}`. Also verify comps math (N≥5 widening ladder, p5/p95 trim, land branch for null/zero `livable_area`).
- **RLS / secrets** (PRD §3.6, §8): CI security gate FAILS if anon/authenticated can write any `public.*`, if anyone but the SECURITY DEFINER proxy can select `app.skiptrace_key.encrypted_key`, or if any exposed relation lacks RLS/GRANT. Worker writes as `service_role`. Stripe webhook verifies the raw-body signature + idempotent on event id. Skip-trace proxy decrypts the key only in-process, resolves vendor host from a server-side allowlist, never persists PII, never logs the key.

## HARD CONSTRAINTS — do not violate
- **AGPL-3.0, public from commit 1.** No secret EVER in the repo. GitHub secret scanning + push protection; gitleaks/trufflehog as a required CI check; full-history scan on first publish; rotate-on-leak. Ship `.env.example` (placeholders, inventory in PRD §8) + `SELF_HOST.md`. Secrets only in env / Actions secrets / Supabase Vault.
- **Design = "The Survey Table, Warmed" (`design/DESIGN.md` + `TOKENS.css`), verbatim.** Architectural brutalism: 3px ink borders, square corners (radius 0), offset HARD shadows (6/8/10px, no blur), visible grid. Fonts **Tanker / Zodiak / Satoshi / Space Mono** (Fontshare + Space Mono; self-host in `_fonts/`). **True Phillies red `#E81828` = signal-only** (distress / the one CTA / active parcel — 1–2 per screen budget); **muddy brick `#A8341F` = text/edge accent only**; blue (Navy/Federal) does the structural + data lifting. Full light + warm-umber dark, WCAG AA, prefers-reduced-motion (offset shadows stay — they're structure). Blueprint map. **Wordmark: PHILLY letter-spaced to equal BRICKS width** (measure after `document.fonts.ready`; see the equalizer in the mockups). All Rowhouse transparency mechanics (source stamps, value-derivation drawer, decomposable distress bar, teach-in-place context rail, community-value framing) rebuilt in this hard-bordered hardware.
- **~$45/mo budget:** Supabase Pro $25 + Vercel Pro $20 (Hobby forbids commercial/payment use); Actions / ZeptoMail free-tier. Map tiles ride on the existing Supabase Pro plan via Supabase Storage (100 GB storage + 250 GB egress included; $0.09/GB egress beyond) — no extra vendor. Supabase Small (+$15) only if nightly refresh strains Micro; **no PITR — 7-day RPO** for v1 (backup posture already decided, PRD §8). Keep DB <8 GB: land-transform-discard raw for big sources, window crime/311 to ~10y, incremental `geo_metric`.
- **Philly behind the `CityAdapter` seam** (PRD §2.1): no Philly literal (table, URL, document_type) outside `packages/core/adapters/`; CI grep gate enforces it. Second city = config + adapters.
- **Skip-trace = BYO-key ONLY** (orchestrate, never resell); auth + per-user lawful-use attestation (active-subscription gate deferred to M8 — login-gated but free in v1); integrated resale deferred.
- Honor as you reach them: GitHub Actions cron needs a **repo-mutating keep-alive** (schedule alone does NOT reset the 60-day idle disable) + external **healthchecks.io** dead-man's-switch on run *absence*; Carto pagination is **keyset on `cartodb_id`** (recording_date is non-unique); OPA S3 `the_geom` is **WKT/EWKT** (parse via `ST_GeomFromText/EWKT`); no `lat`/`lng` anywhere; sheriff scraper honors robots `Crawl-delay: 10`, asserts `<thead>` columns, Bid4Assets enrichment OFF by default; PMTiles is a single object rebuilt nightly to Supabase Storage (no dynamic `ST_AsMVT` base map). Monorepo: `apps/web` · `packages/db` · `packages/ingestion` · `packages/core` · `packages/tiles` · `infra/` (pnpm, TypeScript).

## START HERE
Begin with **M0 (Foundations)** then **M1 (Ingestion core)**; wire the nightly GitHub Actions run and let history start accruing before any UI polish. Treat each milestone's DoD (PRD §9) as an adversarial gate before moving on.

## Human pause-points (do everything around them, then tell Aaron the one thing you need)
- Create the **Supabase Pro** project under org **"STL Agentic"** (us-east-1, enable PostGIS) — confirm the paid $25/mo first; capture project ref + pooled `DATABASE_URL`.
- **ZeptoMail** Send-Mail token (M7); **Stripe** API keys (M8 — monetization deferred); **GitHub** public repo + secret-scanning/push-protection toggles.
Aaron's standing preference: execute autonomously on recoverable actions (commits/pushes to main, deploys, dep installs, running scripts); pause only for genuinely irrecoverable things (real money, third-party messages, unbacked deletes) or steps needing his keyboard.
