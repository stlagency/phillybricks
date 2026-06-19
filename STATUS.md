# Build status

Ingestion-first per PRD §9. State history (change-logs) only accrues forward and is the one irrecoverable asset. **→ Live at https://phillybricks.vercel.app. Resume point: [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md) — finish M4: nightly PMTiles→Supabase Storage + high-zoom parcel layer (needs Supabase Storage S3 access keys, in progress) + map polish (time control, filters, real right-rail).**

**Repo:** https://github.com/stlagency/phillybricks (public, AGPL-3.0, secret-scanning + push-protection on).
**CI:** green — typecheck · lint · tests (443 pass/1 skip) · portability gate · static + **live `pg_catalog` RLS gate** (runs migrations against ephemeral PostGIS) · gitleaks full-history.
**Prod DB:** Supabase `phillybricks` / ref `ctcvrdsrylauqpuxbauz` (us-east-1, PostGIS, PG17) — all 10 migrations applied + RLS verified live. Worker role `phillybricks_worker` reaches it via the transaction pooler; `DATABASE_URL` is a GH Actions secret (+ `memory/database-url.secret` local). Nightly ingests all 14 open-data sources + the sheriff scraper; `parcel_change_log` history accruing (2.3M baseline), `sheriff_listing`=1,576.

| Milestone | What | State |
|---|---|---|
| **M0** | Foundations: monorepo, AGPL, secret hygiene, CI gates, frozen contracts, CityAdapter + philadelphia adapter, 9 migrations (applied + RLS-verified on prod), backup posture | ✅ **done** |
| **M1** | Ingestion core wired live: all 14 sources ingest, per-source join rates measured + thresholds set, `parcel_change_log` accruing (2.3M baseline), nightly green end-to-end | ✅ **done** |
| **M1a** | RTT backfill to 1974 (resumable keyset) | 🔄 running (re-runnable to `drained`) |
| **M2** | Sheriff scraper (phillysheriff, NON-www; generic scrape engine + column-order gate + minRows floor + AbortController timeout; Bid4Assets OFF). Live: `sheriff_listing`=1,576, 1,125 parcels → `on_sheriff_list`. Adversarial review: 7 fixed / 5 dismissed | ✅ **done** |
| **M3** | Derived analytics: real `distress_signal` composite (SQL **generated** from `packages/core` `DISTRESS_CONFIG` → single source of truth with `scoreDistress`; **live parity 0/75**), `comp_candidate` (618,956), incremental `geo_metric` (644,814 rows, 11 metrics, classes a/b, back to 1974), `geo_boundary` (591) + point-in-polygon geo-stamping (583,503 parcels), **matview-ownership/refresh fix** (worker owns → `REFRESH … CONCURRENTLY` verified). 5-dimension adversarial review | ✅ **done** |
| **M4** | Serving + map. **DEPLOYED LIVE** → https://phillybricks.vercel.app (Vercel project `phillybricks`, team `stlagencys-projects`, rootDir `apps/web`, native pnpm-workspace build). All 5 read APIs verified serving real M3 data on the live deployment: `/api/scan` (4 lenses, buckets, period ranges), `/api/parcel/:pk` (full bundle), `/api/comps` (deterministic + transparent estimate), `/api/leads`, `/api/boundaries`. **MapLibre choropleth (`ScanMap`)** wired to the live APIs (real neighborhoods, lens-colored, theme-aware). **Remaining:** nightly PMTiles→Supabase Storage + the high-zoom parcel layer (**Supabase Storage S3 access keys — in progress**); wire the right rail to real geo-detail | 🔄 **deployed; tiles need Supabase Storage** |
| **M5** | Property deep-dive page + bundle endpoint | ⏳ |
| **M6** | Leads + mini-CRM + CSV export + BYO skip-trace proxy | ⏳ |
| **M7** | Accounts, Stripe subscription + verified webhook, saved areas, alerts (Resend digest) | ⏳ |

## Decisions recorded

- **Backup posture (M0 DoD):** accept Supabase daily backups / **7-day RPO**; **skip PITR (+$100)** for v1. The change-log history tables are the irreplaceable asset and are protected by the §4.1 liveness dead-man's-switch (alerts on a missed run). Revisit PITR post-revenue.
- **Cost floor:** ~$45/mo = Supabase Pro $25 + Vercel Pro $20; Actions / Resend free-tier. Map tiles ride on the existing Supabase Pro plan (100 GB storage + 250 GB egress included; $0.09/GB egress beyond) — no extra vendor.
- **Skip-trace:** BYO-key ONLY for v1 (orchestrate, never resell) + per-user lawful-use attestation.
- **Bid4Assets enrichment:** OFF by default in the public repo.

## Human pause-points

1. ~~Supabase Pro project + `DATABASE_URL`~~ — **DONE** (provisioned, migrated, worker role + pooler wired; marginal cost was **$10/mo**, not $25 — STL Agentic was already Pro → true floor ≈ $30/mo).
2. **Vercel Pro** project + env — at **M4** (deploy/serving).
3. **Supabase Storage** bucket + S3 access keys (minted in the Supabase dashboard → Project Settings → Storage → S3 Access Keys) — at **M4** (tiles).
4. **Stripe** + **Resend** API keys — at **M7**.
5. **healthchecks.io** monitor URL (`HEALTHCHECKS_URL`) — wire the liveness dead-man's-switch when convenient.

Everything else proceeds autonomously.
