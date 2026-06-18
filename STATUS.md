# Build status

Ingestion-first per PRD §9. State history (change-logs) only accrues forward and is the one irrecoverable asset — M1's nightly run must start as soon as the Supabase project exists.

| Milestone | What | State |
|---|---|---|
| **M0** | Foundations: monorepo, AGPL, secret hygiene, CI gates, frozen contracts, CityAdapter skeleton, schemas, backup posture | 🟡 in progress |
| **M1** | Ingestion core: `norm_parcel` + quarantine + fixtures, OPA/L&I/tax/crime/311/licenses, per-source join-rate gates, `ops` run/cursor logging, Actions cron + keep-alive + healthchecks liveness | ⏳ code-complete pending live DB |
| **M1a** | RTT backfill to 1974 (resumable keyset) | ⏳ |
| **M2** | Sheriff scraper (phillysheriff core; Bid4Assets OFF by default) | ⏳ |
| **M3** | Derived analytics: distress signal + composite, comp_candidate, incremental geo_metric, geo_boundary | ⏳ |
| **M4** | Serving + map: PMTiles → R2, MapLibre 4-lens scan, read APIs | ⏳ |
| **M5** | Property deep-dive page + bundle endpoint | ⏳ |
| **M6** | Leads + mini-CRM + CSV export + BYO skip-trace proxy | ⏳ |
| **M7** | Accounts, Stripe subscription + verified webhook, saved areas, alerts (Resend digest) | ⏳ |

## Decisions recorded

- **Backup posture (M0 DoD):** accept Supabase daily backups / **7-day RPO**; **skip PITR (+$100)** for v1. The change-log history tables are the irreplaceable asset and are protected by the §4.1 liveness dead-man's-switch (alerts on a missed run). Revisit PITR post-revenue.
- **Cost floor:** ~$45/mo = Supabase Pro $25 + Vercel Pro $20; R2 / Actions / Resend free-tier.
- **Skip-trace:** BYO-key ONLY for v1 (orchestrate, never resell) + per-user lawful-use attestation.
- **Bid4Assets enrichment:** OFF by default in the public repo.

## Human pause-points (need Aaron)

1. **Supabase Pro project** under org "STL Agentic" (us-east-1, PostGIS) — confirm the recurring **$25/mo** first; then capture project ref + pooled `DATABASE_URL` → GitHub Actions secrets + local `.env`.
2. **Stripe** + **Resend** API keys (M7).
3. R2 bucket + keys (M4).

Everything else proceeds autonomously.
