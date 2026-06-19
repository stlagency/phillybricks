# Bandbox

**Open-source (AGPL-3.0), transparency-first Philadelphia residential real-estate market-intelligence tool.**
Assessor's office meets Bloomberg terminal, with a South Philadelphia face: a map-first, multi-resolution, 4-lens scan of public records that shows its work — every figure links to its raw public record — and frames distressed/vacant parcels as neighborhood-recovery opportunities, not flips.

> Know the block before you knock.

## What it is

A nightly-ingested warehouse of Philadelphia public records (OPA assessments, RTT deeds back to 1974, L&I permits/violations, tax delinquency, crime, 311, sheriff sales) served as:

- a **market scan** — multi-resolution ZIP → neighborhood → tract → parcel blueprint map, four lenses (price & value, development momentum, distress & risk, livability);
- a **property deep-dive** — assessment vs. sale, full transfer history, open L&I, taxes, nearby crime/311, arms-length comps + a transparent rule-based value estimate, and a fully decomposable distress score;
- **leads + a mini-CRM**, saved areas, alerts (nightly email digest), and BYO-key skip-trace orchestration — **login-gated but free** (monetization is deferred to M8; a low-flat-subscription seam is built and dormant). **No data is paywalled — only personalization/automation.**

No black boxes: no ML AVM, every derived number decomposes to its public record.

## Why it exists

Off-market and distressed sales never hit the MLS, and MLS comps are gated to licensed agents. The public record is open. Bandbox turns it into an instrument anyone can read.

## Stack

Next.js (App Router) on Vercel · Supabase Postgres + PostGIS · MapLibre + PMTiles (Supabase Storage) + deck.gl overlays · GitHub Actions cron ingestion · ZeptoMail · Stripe (deferred — M8). pnpm monorepo, TypeScript end-to-end. ~$45/mo to run.

```
apps/web            Next.js — market scan, deep-dive, leads, alerts
packages/core       pure logic: CityAdapter, comps, value estimate, distress scoring (frozen contracts)
packages/db         SQL migrations (raw/public/app/ops), RLS/grants, matviews, generated types
packages/ingestion  nightly worker + source adapters (Carto, S3 bulk, phillysheriff scrape)
packages/tiles      tippecanoe → PMTiles → Supabase Storage
infra/              GitHub Actions, CI gates, self-host
```

## Design

"The Survey Table, Warmed" — architectural brutalism (3px ink borders, square corners, offset hard shadows) warmed with a civic, show-the-work transparency layer. See [`design/DESIGN.md`](design/DESIGN.md) and [`TOKENS.css`](TOKENS.css).

## Self-hosting

Philadelphia lives behind a `CityAdapter` seam (`packages/core/src/adapters/`); a second city is config + adapters, not a rewrite. See [`SELF_HOST.md`](SELF_HOST.md). Copy `.env.example` → `.env` and fill placeholders — **secrets never enter the repo.**

## Status

Building M0 → M7 per [`PRD.md`](PRD.md) §9. See [`STATUS.md`](STATUS.md).

## License

[AGPL-3.0-or-later](LICENSE). Built on Philadelphia open data (commercial reuse permitted; no City endorsement implied; "as-is, no warranty").
