# Self-hosting Bandbox

Bandbox is AGPL-3.0 and runs end-to-end on infrastructure you control. This
guide covers the **docker-compose** path: a PostGIS database, the ingestion worker,
and the Next.js web app — plus how to point the `CityAdapter` at a **different city**.

The managed reference deployment (Supabase Pro + Vercel Pro + GitHub Actions, ~$45/mo;
map tiles ride on the same Supabase project via Supabase Storage) is described in
`PRD.md §8`. Self-hosting replaces those managed pieces with the local stack below;
everything else (the schema, the gates, the adapter seam) is identical.

---

## 1. Prerequisites

- **Docker** + **Docker Compose v2** (`docker compose`, not the legacy `docker-compose`).
- ~10 GB free disk for the Postgres volume (the DB-size budget is in `PRD.md §8`).
- Outbound network access (the worker pulls from public Philadelphia open-data
  endpoints; no API key is required for Carto or the OPA S3 bulk CSV).

No secrets are required just to bring the stack up. ZeptoMail / Supabase Storage / skip-trace
keys are only needed for the optional alerting, tiles, and BYO skip-trace surfaces; Stripe is the
dormant subscription seam (deferred to M8 — monetization is off in v1) (`PRD.md §6, §7`).

---

## 2. Configure environment

All configuration is via environment variables — **never** hard-coded secrets
(`PRD.md §8`). Copy the template and fill in what you need:

```bash
cp .env.example .env
# edit .env
```

`.env.example` documents every variable with **NAME · OWNER · REQUIRED? · STORAGE**.
For a minimal local bring-up you only need the database to exist; the compose file
provides safe defaults for `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` and
wires an **in-network** `DATABASE_URL` for the `worker`, `web`, and `migrate` services
automatically (it overrides the pooled cloud DSN from `.env`).

Optional, per surface:

| Want | Set in `.env` |
|---|---|
| Subscriptions (dormant — deferred to M8) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` |
| Alert email digests | `ZEPTOMAIL_TOKEN`, `ZEPTOMAIL_FROM` |
| Map tiles on object storage | `SUPABASE_S3_*` / `SUPABASE_STORAGE_*` (or serve PMTiles from any static host) |
| Liveness alerting | `HEALTHCHECKS_URL` |
| BYO skip-trace | `SUPABASE_VAULT_KEY_ID` (+ per-user encrypted keys) |

> The compose stack does **not** require `SUPABASE_*` — those target the managed
> Supabase deployment. Self-hosting uses the local PostGIS `db` service directly.

---

## 3. Bring up the stack

```bash
# 1. Start Postgres/PostGIS (and keep it running).
docker compose up -d db

# 2. Apply migrations (schemas, norm_parcel, canonical/derived tables, RLS/grants).
#    The `migrate` service is in the `tools` profile — run it on demand:
docker compose run --rm migrate

# 3. Start the web app.
docker compose up -d web
#    → http://localhost:3000  (override with WEB_PORT in .env)

# 4. Run an ingestion pass (the worker is a batch job, not a daemon).
docker compose run --rm worker
```

Useful overrides (all via `.env` or the shell):

| Variable | Default | Purpose |
|---|---|---|
| `DB_PORT` | `5432` | Host port for Postgres |
| `WEB_PORT` | `3000` | Host port for the web app |
| `POSTGRES_DB` | `bandbox` | Database name |

### Scheduling ingestion

In the managed deployment, GitHub Actions runs the nightly/weekly pipelines
(`.github/workflows/nightly.yml`, `weekly.yml`). Self-hosting, you schedule the
**same** worker entrypoints from the host:

```cron
# crontab — nightly pass at 04:17 local, weekly resync Mondays 03:40 local.
17 4 * * *  cd /path/to/bandbox && docker compose run --rm worker
40 3 * * 1  cd /path/to/bandbox && docker compose run --rm worker \
              sh -c 'pnpm --filter @bandbox/ingestion run:nightly --task=sheriff && \
                     pnpm --filter @bandbox/ingestion run:nightly --task=rtt-resync'
```

The worker is **cursor-resumable** (`ops.source_cursor`, `PRD.md §4.1`): a run that
dies mid-backfill resumes from its last committed page on the next invocation.

> **Liveness still matters when self-hosting.** A run that never starts is the one
> fatal, irrecoverable failure (`PRD.md §10`). Set `HEALTHCHECKS_URL` so each
> successful run pings a dead-man's-switch that alerts on a *missing* run — host cron
> failing silently is exactly what it guards against. The GitHub-Actions keep-alive
> commit (`infra/scripts/keepalive.mjs`) is a GitHub-specific concern and is **not**
> needed for host-cron self-hosting.

---

## 4. Verify it's healthy

```bash
# DB up?
docker compose exec db pg_isready -U postgres

# Migrations applied — schemas present?
docker compose exec db psql -U postgres -d bandbox \
  -c "select nspname from pg_namespace where nspname in ('raw','public','app','ops') order by 1;"

# Security posture (the live gate) — introspects pg_catalog against the same DB CI uses.
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bandbox \
  node infra/scripts/security-gate-live.mjs
```

The last command is the **same** gate CI runs (`infra/scripts/security-gate-live.mjs`,
`PRD.md §3.6`): it fails if `anon`/`authenticated` can write any `public.*` table, can
read `app.skiptrace_key`, or if an exposed relation lacks RLS/GRANT. Running it against
your self-hosted DB confirms your grant matrix matches the managed one.

---

## 5. Point the CityAdapter at a new city

Bandbox is **Philly now, portable later** (`PRD.md §0.5, §2.1`). Every
city-specific literal — source table names, endpoint hosts, parcel-key rules,
document-type vocabularies, geo-boundary sources — lives behind the `CityAdapter`
contract in `packages/core/src/contracts/city-adapter.ts`. **No city literal is
allowed anywhere else** — a CI gate (`infra/scripts/portability-grep.mjs`) fails the
build if one leaks. A second city is **config + adapters, not a rewrite**.

To add a city:

1. **Author an adapter** under `packages/core/src/adapters/<city>.ts` implementing the
   frozen `CityAdapter` interface. Fill in:
   - `city` — the slug (e.g. `'pittsburgh'`).
   - `sources: SourceSpec[]` — one per dataset (`platform`, `endpoint`, candidate
     `keyColumns`, `cursorColumn` for keyset pagination, `cadence`, target table, and
     the **measured** `expectedJoinRate` gate baseline; spatial-only sources leave it
     undefined and are exempt from the parcel-join gate).
   - `normParcelKey(raw)` — the city's parcel-key normalizer. Keep it **identical** to
     the SQL `norm_parcel` for that city and fixture-test both (`PRD.md §3.1, §8`).
   - `documentTypes` — the local transfer vocab (`armsLength` / `distress` / `sheriff`
     codes + `estateNameRegex`). Each literal must match ≥1 live source row.
   - `nominalConsiderationFloor`, `geoSources`, optional `scraper`
     (with its **Crawl-delay**), and `lensMetricSql`.

2. **Select the adapter at runtime.** The worker and web app read the active city from
   configuration — set the city slug in your environment / worker config so the
   pipeline loads `<city>` instead of `philadelphia`. (The selection mechanism is the
   `@bandbox/core` adapter registry; see that package's exports.)

3. **Measure, don't assume, the join rates.** Run an initial ingest and read the
   per-source normalized join rates from `ops.ingest_run`, then set each source's
   `expectedJoinRate` from the measured baseline — never a uniform 98% (`PRD.md §3.1`).

4. **Run the gates.** Before committing, confirm the portability + security gates pass:
   ```bash
   pnpm gate:portability   # no city literals outside packages/core/src/adapters/
   pnpm gate:security       # static RLS/grant pass
   docker compose run --rm migrate
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/bandbox \
     node infra/scripts/security-gate-live.mjs   # live RLS/grant pass
   ```

Because the schema, gates, and pipeline are city-agnostic, the same compose stack now
serves the new city — only the adapter changed.

---

## 6. Notes & limitations of the compose path

- **Dockerfiles are scaffolds.** `infra/docker/worker.Dockerfile` and
  `web.Dockerfile` build from the repo root over the full pnpm workspace. They are
  correct but unoptimized; the documented TODOs inside (production prune for the
  worker, Next `output: 'standalone'` + multi-stage for web) are finalized in the
  worker (M1) and web (M4) milestones.
- **PMTiles / map tiles.** The reference deployment writes a single nightly PMTiles
  object to Supabase Storage (`PRD.md §6`). Self-hosting, point
  `SUPABASE_STORAGE_PUBLIC_BASE_URL` at any static host that supports HTTP range
  requests, or serve the `.pmtiles` file from a local static server.
- **Backups.** The change-log history tables (`PRD.md §3.3`) are the one irreplaceable
  asset. Self-hosting, take your own `pg_dump`/volume snapshots on a schedule — the
  managed deployment relies on Supabase daily backups (`PRD.md §8`).
