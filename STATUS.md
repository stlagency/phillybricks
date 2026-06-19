# Build status

Ingestion-first per PRD §9. State history (change-logs) only accrues forward and is the one irrecoverable asset. **→ Live at https://bandbox.vercel.app. Resume point: [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md) — M0–M6 complete + live.**

> **✅ Rescope executed (2026-06-19).** The PhillyBricks→Bandbox rebrand + monetization descope + Resend→ZeptoMail swap (the plan in **[`docs/SCOPE_NEXT.md`](docs/SCOPE_NEXT.md)**) is **done**: (1) renamed to **Bandbox**, domain **www.bandbox.pro** (name only — South-Philly voice + tagline + brutalist design unchanged; internal infra names `phillybricks_worker`/`phillybricks-tiles`/`pb-*` kept); (2) the export + skip-trace gates are now **login-gated but free** (`requireUser`) — the Stripe/`app.subscription` entitlement seam is kept **dormant**, monetization deferred to **M8**; (3) the alert digest now targets **ZeptoMail**. Live URL is `https://bandbox.vercel.app` until the **www.bandbox.pro** DNS record is wired (Cloudflare — pending a DNS token).

**Repo:** https://github.com/stlagency/bandbox (public, AGPL-3.0, secret-scanning + push-protection on).
**CI:** green — typecheck · lint · tests (443 pass/1 skip) · portability gate · static + **live `pg_catalog` RLS gate** (runs migrations against ephemeral PostGIS) · gitleaks full-history.
**Prod DB:** Supabase `phillybricks` (project/DB name kept — internal infra unchanged) / ref `ctcvrdsrylauqpuxbauz` (us-east-1, PostGIS, PG17) — all 10 migrations applied + RLS verified live. Worker role `phillybricks_worker` reaches it via the transaction pooler; `DATABASE_URL` is a GH Actions secret (+ `memory/database-url.secret` local). Nightly ingests all 14 open-data sources + the sheriff scraper; `parcel_change_log` history accruing (2.3M baseline), `sheriff_listing`=1,576.

| Milestone | What | State |
|---|---|---|
| **M0** | Foundations: monorepo, AGPL, secret hygiene, CI gates, frozen contracts, CityAdapter + philadelphia adapter, 9 migrations (applied + RLS-verified on prod), backup posture | ✅ **done** |
| **M1** | Ingestion core wired live: all 14 sources ingest, per-source join rates measured + thresholds set, `parcel_change_log` accruing (2.3M baseline), nightly green end-to-end | ✅ **done** |
| **M1a** | RTT backfill to 1974 (resumable keyset) | 🔄 running (re-runnable to `drained`) |
| **M2** | Sheriff scraper (phillysheriff, NON-www; generic scrape engine + column-order gate + minRows floor + AbortController timeout; Bid4Assets OFF). Live: `sheriff_listing`=1,576, 1,125 parcels → `on_sheriff_list`. Adversarial review: 7 fixed / 5 dismissed | ✅ **done** |
| **M3** | Derived analytics: real `distress_signal` composite (SQL **generated** from `packages/core` `DISTRESS_CONFIG` → single source of truth with `scoreDistress`; **live parity 0/75**), `comp_candidate` (618,956), incremental `geo_metric` (644,814 rows, 11 metrics, classes a/b, back to 1974), `geo_boundary` (591) + point-in-polygon geo-stamping (583,503 parcels), **matview-ownership/refresh fix** (worker owns → `REFRESH … CONCURRENTLY` verified). 5-dimension adversarial review | ✅ **done** |
| **M4** | Serving + map. **DEPLOYED LIVE** → https://bandbox.vercel.app. All 5 read APIs + `/api/geo` serve real M3 data; MapLibre 4-lens scan + per-parcel PMTiles on Supabase Storage; nightly tile rebuild automated (CI secrets set) | ✅ **done** |
| **M5** | Property deep-dive page + bundle endpoint. Every figure binds to live, sourced data — neighborhood name, real tallies/L&I/tax, computed change-since-sale, generated distress narrative, real OPA/Atlas record links; **zero fabricated values** (adversarial honesty review, 3 issues fixed). DoD: any parcel renders a full sourced underwrite + decomposable distress | ✅ **done** |
| **M6** | Leads + mini-CRM + CSV export + BYO skip-trace. `/leads` surface (controlled FilterRail w/ honest facet counts, distress-floor + multi-signal + value + neighborhood filters), server-streamed CSV export (no PII, RFC-4180 + formula-injection neutralized, row-cap), `app.saved_lead` upsert CRUD, BYO skip-trace proxy (vendor allowlist/SSRF-closed, attestation, rate-limit, decrypt seam, no key/PII leak — 12 unit tests). **Paid surfaces gated by the `lib/auth.ts` seam (401/403 pre-auth); M7 wires real Supabase Auth into it.** Adversarial security+correctness review, 5 findings fixed | ✅ **done (app-layer); auth enforcement = M7** |
| **M7** | Accounts + alerts (**free**): Supabase Auth → the `lib/auth.ts` seam (lights up the free, login-gated export/save/skip-trace); saved areas (3 modes); alert diff → `alert_event` → **nightly ZeptoMail digest** + in-app feed. **No Stripe.** | ⏳ |
| **M8** | Monetization (**deferred, when validated**): Stripe low-flat sub + **verified webhook**; flip the two free gates back to `requireEntitlement` (dormant seam already in place) | 💤 deferred |

## Decisions recorded

- **Backup posture (M0 DoD):** accept Supabase daily backups / **7-day RPO**; **skip PITR (+$100)** for v1. The change-log history tables are the irreplaceable asset and are protected by the §4.1 liveness dead-man's-switch (alerts on a missed run). Revisit PITR post-revenue.
- **Cost floor:** ~$45/mo = Supabase Pro $25 + Vercel Pro $20; Actions / ZeptoMail free-tier. Map tiles ride on the existing Supabase Pro plan (100 GB storage + 250 GB egress included; $0.09/GB egress beyond) — no extra vendor.
- **Skip-trace:** BYO-key ONLY for v1 (orchestrate, never resell) + per-user lawful-use attestation.
- **Bid4Assets enrichment:** OFF by default in the public repo.

## Human pause-points

1. ~~Supabase Pro project + `DATABASE_URL`~~ — **DONE** (provisioned, migrated, worker role + pooler wired; marginal cost was **$10/mo**, not $25 — STL Agentic was already Pro → true floor ≈ $30/mo).
2. **Vercel Pro** project + env — at **M4** (deploy/serving).
3. **Supabase Storage** bucket + S3 access keys (minted in the Supabase dashboard → Project Settings → Storage → S3 Access Keys) — at **M4** (tiles).
4. **ZeptoMail** Send-Mail token (`ZEPTOMAIL_TOKEN`) + a verified `bandbox.pro` sending domain (DKIM/SPF) — at **M7** (alert digest).
5. **Stripe** API keys — at **M8** only (monetization deferred; not needed for M7).
6. **www.bandbox.pro DNS** — add the Vercel CNAME/A record at the Cloudflare zone (needs a DNS-capable Cloudflare token; the connected Cloudflare integration is storage/compute only). Until then the live URL is `bandbox.vercel.app`.
7. **healthchecks.io** monitor URL (`HEALTHCHECKS_URL`) — wire the liveness dead-man's-switch when convenient.

Everything else proceeds autonomously.
