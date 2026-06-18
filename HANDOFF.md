# PhillyBricks — Build Handoff

Open-source (AGPL), transparency-first **Philadelphia residential real-estate market-intelligence tool**. Greenfield. This file orients a fresh session; to actually kick off the build, use `NEW_SESSION_BUILD_PROMPT.md`.

## Status
| Layer | State |
|---|---|
| Product scope | **Locked** — `CONCEPT_v2_shared_understanding.md` |
| Engineering plan | **`PRD.md` v1.1** — adversarially reviewed |
| Design system | **Unified & verified** — `design/DESIGN.md` + `TOKENS.css` + `design/mockups/` ("The Survey Table, Warmed") |
| Verified data facts | **In-repo** — `docs/DATA_SOURCES.md` |
| Code | **None yet.** Next = build M0→M7. |

## Read order (cold start — do this first)
1. **`PRD.md`** — engineering source of truth (the HOW; data model, ingestion, API, milestones M0–M7 with DoDs).
2. **`CONCEPT_v2_shared_understanding.md`** — product scope (the WHAT) + the off-market public-record thesis.
3. **`design/DESIGN.md`** + **`TOKENS.css`** — visual source of truth; skim `design/mockups/01-market-scan.html` + `02-property-deep-dive.html` (open in a browser; `DARK` toggles).
4. **`docs/DATA_SOURCES.md`** — verified live-data facts (table names, row counts, endpoints, the parcel-key hazard).
5. **`BRAND.md`** — brand voice + the PHILLY/BRICKS logo + the third-gen South Philly voice.

## What it is, in one line
A serious civic-data instrument — *assessor's office meets Bloomberg terminal* — with a South Philadelphia face: a map-first, multi-resolution, 4-lens scan that shows its work (every figure links to its raw public record) and frames distressed/vacant parcels as neighborhood-recovery opportunities, not flips.

## Build approach
Run it as an **ultracode multi-agent workflow**, **ingestion-first** (M0 → M1, let the nightly run start accruing change-log history immediately — it is irrecoverable), with **adversarial verification gates** at the four correctness-critical points: the `norm_parcel` normalizer, the per-source empirical join-rate gates, the distress-score 0–1 composite math + decomposition, and the RLS/secrets CI gate. Full instructions: `NEW_SESSION_BUILD_PROMPT.md`.

## Cost & infra
~**$45/mo** (Supabase Pro $25 + Vercel Pro $20; R2/Actions/Resend free-tier). Backups: **7-day RPO** (no PITR for v1). Stack: Next on Vercel · Supabase Postgres+PostGIS · MapLibre+deck.gl · Cloudflare R2 (PMTiles) · GitHub Actions cron ingestion. Monorepo (pnpm), TypeScript end-to-end.

## Human pause-points (need Aaron's keyboard — everything else is autonomous)
- **Create the Supabase Pro project** under org **"STL Agentic"** (us-east-1; enable PostGIS) — confirm the paid $25/mo before creating; capture the project ref + pooled `DATABASE_URL`.
- **Stripe** + **Resend** dashboard API keys.
- **GitHub**: create the public AGPL repo; enable secret scanning + push protection.

## Archived / superseded (do not build from these)
`design/_archive/` holds the earlier "Rowhouse" mockups + the pure-brutalist `brand-presenter.html` and the stale `design-system-rowhouse.json`. They're kept for history; the **unified** system in `design/DESIGN.md` supersedes them.
