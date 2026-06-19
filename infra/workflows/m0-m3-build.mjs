export const meta = {
  name: 'bandbox-build',
  description: 'Build Bandbox M0→M3 across packages, then adversarially verify the 4 correctness gates',
  phases: [
    { title: 'Foundational build', detail: 'core, db, web, infra in parallel (disjoint dirs)' },
    { title: 'Dependent build', detail: 'ingestion, tiles against core/db public APIs' },
    { title: 'Adversarial gates', detail: 'skeptic agents attack norm_parcel, join-rate, distress math, RLS/secrets' },
  ],
};

// ----- shared context every agent gets -----
const COMMON = `
You are a senior engineer building Bandbox — an AGPL, transparency-first Philadelphia
real-estate intelligence tool. The repo is a pnpm + TypeScript monorepo at the cwd. The M0
skeleton already exists and installs cleanly. READ these before coding (they are the source of
truth): PRD.md (engineering), docs/DATA_SOURCES.md (verified data facts), and the frozen shared
type contracts in packages/core/src/contracts/*.ts (CityAdapter, distress, comps, api).

HARD RULES (violating any fails the build):
- ONLY create/edit files inside YOUR assigned directory. NEVER touch the repo root, another
  package's files, package.json/tsconfig of any package (already written), or
  packages/core/src/contracts/** (FROZEN — import from it, never edit it).
- Do NOT run "pnpm install", "git", or any root-level build. You MAY run your own package's
  "pnpm --filter <pkg> typecheck" and "pnpm --filter <pkg> test" to self-verify (deps are
  already installed). If you genuinely need a dependency that is not installed, DO NOT install
  it — list it in your return "blockers".
- No secrets, ever. Read config from process.env. No lat/lng columns (coords live in geometry).
- Match the surrounding style; strict TypeScript (noUncheckedIndexedAccess is on).
Return ONLY the structured object the schema asks for.
`;

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['package', 'files_written', 'public_api', 'tests', 'blockers', 'notes'],
  properties: {
    package: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    public_api: { type: 'array', items: { type: 'string' }, description: 'exact exported symbols + signatures other packages can rely on' },
    tests: {
      type: 'object',
      additionalProperties: false,
      required: ['added', 'passing', 'summary'],
      properties: {
        added: { type: 'number' },
        passing: { type: 'boolean' },
        summary: { type: 'string' },
      },
    },
    blockers: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gate', 'verdict', 'attacks', 'must_fix', 'evidence'],
  properties: {
    gate: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail', 'partial'] },
    attacks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'expected', 'actual', 'passed'],
        properties: {
          name: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          passed: { type: 'boolean' },
        },
      },
    },
    must_fix: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
};

// ============================ WAVE 1 — FOUNDATIONAL ============================
phase('Foundational build');

const CORE = `${COMMON}
YOUR DIRECTORY: packages/core/src (plus tests in packages/core/test). Package name @bandbox/core.
You own pure logic. Two of the four correctness gates live here (distress math, comps). Implement,
extend packages/core/src/index.ts to export your modules, and write thorough golden unit tests.

Deliver, each in its own file under packages/core/src:
1. adapters/philadelphia.ts — export const philadelphia: CityAdapter (import the type from ../contracts).
   This is the ONLY place Philly source literals may live. Fill from docs/DATA_SOURCES.md + PRD §4.2/§5.1:
   - city: 'philadelphia'
   - normParcelKey(raw): 9 digits → as-is; strip non-digits first; 1–8 digits → left-pad to 9 with '0';
     >9 digits OR empty/non-numeric → null. MUST mirror the SQL norm_parcel exactly. NEVER derive from
     parcel_id_num (L&I decoy).
   - sources: SourceSpec[] for OPA (s3 bulk CSV, WKT geom), rtt_summary (carto keyset on cartodb_id,
     keyColumns ['opa_account_num'] + also note pin path), permits/violations/complaints/case_investigations
     (carto keyset), unsafe/imm_dang/demolitions, real_estate_tax_delinquencies, real_estate_tax_balances,
     incidents_part1_part2 (spatial, expectedJoinRate undefined), public_cases_fc (spatial), business_licenses.
     Set cursorColumn:'cartodb_id' where carto. expectedJoinRate: leave undefined for spatial; for parcel
     sources set a documented PLACEHOLDER baseline (e.g. rtt 0.60 on parcel_number, current-state 0.98) with
     a comment that M1 MEASURES and overwrites these.
   - documentTypes: armsLength ['DEED','DEED MISCELLANEOUS','MISCELLANEOUS DEED']; sheriff
     ['DEED SHERIFF',"SHERIFF'S DEED"]; distress [sheriff + 'DEED OF CONDEMNATION','DM - LIS PENDENS',
     'DEED LAND BANK','DEED - ADVERSE POSSESSION']; estateNameRegex
     /ESTATE OF|EXECUT(OR|RIX)|ADMINISTRAT(OR|RIX)|TRUSTEE/i.
   - nominalConsiderationFloor: 1000; geoSources (Azavea neighborhoods GeoJSON, ZIP, tracts — URLs from PRD);
     scraper { urls: phillysheriff mortgage+foreclosure, expectedColumns, crawlDelaySec: 10 };
     lensMetricSql: a Record<LensMetric,string> of SQL snippets selecting the metric from public.geo_metric.
2. transfers.ts — deriveTransferFlags(row, adapter) returning
   { is_sheriff, is_distress_doc, is_estate_or_nonmarket, is_arms_length, price_to_assessment } per PRD §5.1.
   is_estate_or_nonmarket also true on same-surname intra-family proxy with nominal consideration.
3. scoring/config.ts — export DISTRESS_CONFIG: a VERSIONED config (version string + per-component
   {weight, normalize fn descriptor}) for all 9 DistressComponentKey values; weights MUST sum to exactly 1.
   Use these default weights: tax_delinquent .20, actionable_sheriff_flag .12, open_violations .14,
   unsafe_or_imm_dang .12, recent_complaints .08, on_sheriff_list .10, out_of_state_owner .06,
   vacancy_proxy .12, below_market_last_sale .06.
4. scoring/distress.ts — scoreDistress(input, config=DISTRESS_CONFIG): DistressResult. Each sub-score
   normalized to [0,1] via a DOCUMENTED transform (booleans→{0,1}; counts/dollars→capped piecewise with
   stated cap; absent/null signal → normalized 0). composite score01 = Σ(weight·normalized) ∈ [0,1];
   score100 = round(score01*100). Emit components array EXACTLY matching the DistressComponent contract
   (component,label,raw_value,raw_display,normalized,weight,contribution,source_url,source_stamp) and set
   weightsVersion. contribution = weight*normalized.
5. comps/comps.ts — selectComps(subject, candidates, opts): CompsResult and estimateValue. Arms-length only;
   filter by radius (haversine on lat/lon passed in opts) OR same neighborhood_id; similar beds (±1),
   livable_area (±25%), year_built (±15y), same broad category. Min-sample floor N≥5 with the deterministic
   widening ladder (recency 18→36mo → radius rings → drop year band → drop beds band); if still <5 →
   insufficient:true, estimate.estimate:null (explicit empty state). Trim $/sqft outside [p5,p95] before
   distribution/estimate; surface trimmed count. estimate = median_$psf × livable_area with visible
   adjustments; null/zero livable_area → land branch (price-per-lot). Annotate each comp with why (distance,
   deltas, is_median). Return the full CompsResult contract shape.

Then extend packages/core/src/index.ts to export: philadelphia, deriveTransferFlags, DISTRESS_CONFIG,
scoreDistress, selectComps, estimateValue (keep the existing contracts re-export + CORE_VERSION).

GOLDEN TESTS in packages/core/test (vitest):
- norm_parcel parity: '12345'→'000012345'; '52-3-456' style dashed → normalized; the L&I parcel_id_num
  decoy value must NOT produce a 9-digit OPA that collides (treat a >9-digit input → null); ''/null → null;
  exactly 9 digits → unchanged.
- distress: weights sum to 1 (assert to 1e-9); every component normalized ∈[0,1]; score01 ∈[0,1];
  a parcel with all signals present scores higher than one with none; decomposition shape exact;
  contribution = weight*normalized.
- comps: N≥5 ladder widens deterministically; <5 → insufficient empty state; p5/p95 trim drops outliers
  and reports trimmed_count; null livable_area → land branch.
- transfer flags: sheriff/estate/arms-length classification on representative rows; $1 estate deed is NOT
  arms-length.
Run "pnpm --filter @bandbox/core test" and "pnpm --filter @bandbox/core typecheck" until green.`;

const DB = `${COMMON}
YOUR DIRECTORY: packages/db (migrations/, src/, test/). Package name @bandbox/db.
You own the SQL schema. The RLS/secrets gate is one of the four correctness gates and is graded against
your migrations by infra/scripts/security-gate.mjs — make it pass.

Deliver ordered, idempotent SQL migrations in packages/db/migrations/ (NNNN_name.sql, e.g. 0001_…):
- 0001 extensions + schemas: create extension postgis; create schema raw, public is default, app, ops.
- 0002 norm_parcel: the immutable SQL function from PRD §3.1 EXACTLY (9 digits→as-is; 1–8→lpad 9;
  >9 or empty→null). Plus ops.parcel_key_quarantine(raw_key, source, reason, ingested_at) and a
  malformed_key_count column on ops.ingest_run.
- 0003 ops.*: ops.ingest_run (source, started/finished, rows_in, rows_promoted, join rates jsonb,
  malformed_key_count, status, error text), ops.source_cursor (source pk, last_cartodb_id/watermark,
  rows_committed, run_id, updated_at). ENABLE RLS + deny all; GRANT nothing to anon/authenticated.
- 0004 public canonical tables per PRD §3.2: parcel (PK parcel_pk text, pin text, is_active, retired_at,
  geom geometry(Point,4326), all listed cols incl derived is_out_of_state_owner + neighborhood_id/zip_id/
  tract_id; GIST(geom), btree zip/neighborhood_id/pin); transfer (transfer_id PK, cartodb_id, parcel_pk
  nullable NO physical FK, document_type, recording_date, considerations, grantors, grantees, derived flag
  cols, price_to_assessment); permit/violation/complaint/case_investigation (parcel_pk nullable);
  distress_inventory (kind); sheriff_listing (per §3.2 incl raw_assessment_id, sale_type, source_sale_type,
  sale_status, enrichment_status, nullable parcel_pk); crime_incident + service_request (geom Point 4326,
  occurred_on, category, tract_id/zip_id/neighborhood_id stamped; GIST + btree).
- 0005 change-log/history (§3.3): public.parcel_change_log (parcel_pk, field, old_value, new_value,
  changed_on) with baseline-row convention documented in a comment; public.delinquency_event,
  public.violation_event (store standing flags each load).
- 0006 derived (§3.4): public.distress_signal matview UNIQUE(parcel_pk); public.comp_candidate matview
  UNIQUE on its grain; public.geo_metric REGULAR table UNIQUE(geo_type,geo_id,period,metric);
  public.geo_boundary (geo_type, geo_id, name, geom polygon 4326, GIST). Add the required UNIQUE indexes
  so REFRESH … CONCURRENTLY works. Matviews carry NO RLS (access is GRANT-only).
- 0007 app.* user tables (§3.5) with RLS owner-only using (user_id = auth.uid()): profile, subscription
  (written only by service_role — no anon/authenticated write grant), saved_area (geom Polygon 4326),
  saved_lead, alert_subscription (last_sent_at), alert_event, skiptrace_key (vendor, encrypted_key) —
  REVOKE SELECT on skiptrace_key FROM anon, authenticated.
- 0008 RLS + GRANT matrix (§3.6) APPLIED TO EVERY public.* TABLE: ENABLE ROW LEVEL SECURITY; a
  permissive select policy using(true); REVOKE INSERT,UPDATE,DELETE ON <t> FROM anon, authenticated;
  GRANT SELECT ON <t> TO anon, authenticated. GRANT SELECT on matviews + geo_metric to anon, authenticated.
  The worker writes as service_role (RLS-bypassing) — no extra grant needed. Make
  infra/scripts/security-gate.mjs pass (run: node infra/scripts/security-gate.mjs).
Also: packages/db/src/migrate.ts — a tiny runner that applies migrations/*.sql in order over DATABASE_URL
(uses the installed 'postgres' client; reads files; records applied migrations in a public/ops table;
idempotent). packages/db/src/index.ts — export the runner + a Database types placeholder + canonical
table-name string constants (PUBLIC_TABLES etc.). A vitest test that parses every migration .sql and
asserts the security-gate invariants (so regressions fail in unit tests too).
Run "node infra/scripts/security-gate.mjs" and "pnpm --filter @bandbox/db typecheck" until green.`;

const WEB = `${COMMON}
YOUR DIRECTORY: apps/web (src/, public/, config files). Package name @bandbox/web (Next.js App Router).
You build the design system + the two reference surfaces against the FROZEN contracts, using typed mock
data (no live DB yet). Design is settled — implement "The Survey Table, Warmed" VERBATIM.

READ FIRST: design/DESIGN.md, TOKENS.css, BRAND.md (voice/logo), and BOTH reference mockups
design/mockups/01-market-scan.html + 02-property-deep-dive.html. The mockups are the visual ground truth —
port them to React faithfully (every component, the blueprint SVG map, the decomposable distress bar, the
value-derivation drawer, the teach-in-place context rail, source stamps, light+dark toggle, the Wordmark
equalizer that letter-spaces PHILLY to equal BRICKS width after document.fonts.ready).

Deliver:
- next.config.mjs, next-env.d.ts, src/app/layout.tsx, src/app/globals.css. Copy TOKENS.css content into the
  global CSS (or import it). Self-host fonts: copy the woff2 + @font-face from the repo _fonts/ into
  apps/web/public/fonts and reference them (do NOT rely on the Fontshare/Google CDN @import for production;
  keep a self-hosted @font-face block). Fonts: Tanker, Zodiak, Satoshi, Space Mono.
- A reusable component kit in src/components: Wordmark (with the fonts.ready equalizer), ThemeToggle
  (data-theme on <html>, persist to localStorage, default respects prefers-color-scheme), TopBand/nav,
  Card, MetricStrip/MetricCell (incl the red-budget single-red rule), Pill (danger/neutral/aged/blue),
  Ledger table, SourceStamp, DistressBar (decomposable, hover/focus → {component,raw,normalized,weight,
  contribution,source}), ValueDerivationDrawer, ContextRail (teach-in-place), LensSwitcher, BlueprintMap
  (SVG choropleth like the mockup with the 4 lens ramps + active-parcel red outline + corner ticks + legend
  + instrument readout + time strip), Button (primary red CTA budget / secondary / ghost), CommunitySignal.
  Honor the red discipline (1–2 true-red elements/screen), 3px ink borders, square corners, offset hard
  shadows (no blur), prefers-reduced-motion (shadows stay), WCAG AA both themes.
- src/lib/mock/ — typed fixtures shaped EXACTLY like the contracts in @bandbox/core/contracts
  (ParcelDeepDive, ScanResponse, CompsResult, DistressResult, LeadsResponse). Import the TYPES from
  @bandbox/core. Use believable Philly data (Point Breeze / Fishtown like the mockups).
- src/app/page.tsx → Market Scan surface (route '/'); src/app/parcel/[pk]/page.tsx → Property Deep-Dive,
  rendered from the mock ParcelDeepDive. Both server components where possible, client components for the
  interactive bits (map, theme, drawer, rail). Wire the distress decomposition + comps derivation drawer +
  source stamps + glossary rail exactly as the mockups behave.
- A src/components/README or comment noting which props will later come from /api/parcel/:pk, /api/scan, etc.
Run "pnpm --filter @bandbox/web typecheck" and "pnpm --filter @bandbox/web build" until both pass.
Do NOT start a dev server (the orchestrator verifies in-browser afterward).`;

const INFRA = `${COMMON}
YOUR DIRECTORY: infra/ and .github/workflows/ and SELF_HOST.md + docker-compose.yml at repo root
(these two root files do not yet exist — you MAY create them; do not touch other root files).
You own CI/CD, the nightly orchestration, liveness, the live security gate, and self-host docs.

Deliver:
- .github/workflows/ci.yml — on push/PR: setup pnpm + node 20; pnpm install --frozen-lockfile;
  pnpm typecheck; pnpm lint; pnpm test; pnpm gate:portability; gitleaks (use gitleaks/gitleaks-action or
  install the binary) with .gitleaks.toml; AND a job "security-gate-live" that spins a postgis/postgis:16-3.4
  service container, runs the db migrations against it (node packages/db/src/migrate.ts with a localhost
  DATABASE_URL), then runs infra/scripts/security-gate-live.mjs which introspects pg_catalog and FAILS if
  anon/authenticated hold INSERT/UPDATE/DELETE on any public.* table, if anon/authenticated can SELECT
  app.skiptrace_key, or if any exposed relation lacks RLS/GRANT. Also run the static
  infra/scripts/security-gate.mjs. Use the standard GitHub-hosted runner.
- infra/scripts/security-gate-live.mjs — the live pg_catalog introspection gate described above (uses the
  installed 'postgres' client + DATABASE_URL). Keep the static one as the fast path.
- .github/workflows/nightly.yml — cron (staggered after Philly morning refresh, UTC); runs the ingestion
  worker; a REPO-MUTATING keep-alive step (commit a heartbeat file under infra/heartbeat/ or post an issue
  comment) because the schedule trigger alone does NOT reset GitHub's 60-day idle auto-disable; on success,
  curl the HEALTHCHECKS_URL (dead-man's-switch alerts on run ABSENCE). 6h job cap; resumable.
- .github/workflows/weekly.yml — sheriff scrape + RTT weekly full keyset re-sync; honor crawl-delay.
- infra/scripts/keepalive.mjs — writes/updates infra/heartbeat/last-run.txt with a timestamp passed via env
  (do not call Date.now() in a way that breaks determinism; read an env var the workflow sets) so the commit
  mutates the repo.
- SELF_HOST.md (root) — docker-compose path: Postgres+PostGIS, the worker, the web app; how to set env from
  .env.example; how to point the CityAdapter at a new city. docker-compose.yml (root) — postgis + web + a
  worker service (build contexts referencing the packages; it's fine if images are placeholders documented
  as TODO where a Dockerfile is needed — note them).
- infra/heartbeat/last-run.txt — seed file so the keep-alive has something to update.
Do not run the workflows. Just author them correctly. Keep YAML valid (you may sanity-check with a YAML
parse via node if available, else inspect carefully).`;

const wave1 = await parallel([
  () => agent(CORE, { label: 'build:core', phase: 'Foundational build', schema: BUILD_SCHEMA }),
  () => agent(DB, { label: 'build:db', phase: 'Foundational build', schema: BUILD_SCHEMA }),
  () => agent(WEB, { label: 'build:web', phase: 'Foundational build', schema: BUILD_SCHEMA }),
  () => agent(INFRA, { label: 'build:infra', phase: 'Foundational build', schema: BUILD_SCHEMA }),
]);

// ============================ WAVE 2 — DEPENDENT ==============================
phase('Dependent build');

const coreApi = (wave1[0] && wave1[0].public_api ? wave1[0].public_api.join('\n') : 'see packages/core/src/index.ts');
const dbApi = (wave1[1] && wave1[1].public_api ? wave1[1].public_api.join('\n') : 'see packages/db/src/index.ts');

const INGESTION = `${COMMON}
YOUR DIRECTORY: packages/ingestion (src/, test/). Package name @bandbox/ingestion.
You own the nightly worker + source adapters. The per-source JOIN-RATE gate is one of the four correctness
gates. core + db are now implemented; rely on these public APIs:
--- @bandbox/core exports ---
${coreApi}
--- @bandbox/db exports ---
${dbApi}
Import the CityAdapter 'philadelphia' and deriveTransferFlags from @bandbox/core. Import the type
contracts from @bandbox/core/contracts.

Deliver under packages/ingestion/src:
- normParcel.ts — a TS normalizer that MIRRORS the SQL norm_parcel and core's normParcelKey EXACTLY
  (delegate to philadelphia.normParcelKey to guarantee parity). Plus a quarantine helper.
- pipeline.ts — the ordered worker steps (PRD §4.1): normalize → load raw/staging → validate(per-source
  gate) → promote canonical (atomic) → diff→change-log/alert → refresh derived → trigger tile build.
  Invariant: diff + derived-refresh run ONLY after a source's full batch is promoted.
- joinRate.ts — measureJoinRate(staged, keyPaths): for each candidate key path, normalize and compute the
  fraction that joins to public.parcel; returns per-key rates. The gate compares to the adapter's
  expectedJoinRate (per source); BELOW threshold → quarantine + alert, NEVER halt; spatial sources (no
  expectedJoinRate) are exempt (validate geom not-null + point-in-city instead). Write run stats to
  ops.ingest_run.
- adapters/carto.ts — keyset pagination on cartodb_id (WHERE cartodb_id > $cursor ORDER BY cartodb_id
  LIMIT page), bounded page size (~10MB client buffer / 30s). format=geojson or ST_X/ST_Y for geometry.
  Resumable via ops.source_cursor. Carto needs NO key.
- adapters/opaBulk.ts — fetch the OPA S3 bulk CSV, stream-parse (csv-parse), parse the_geom WKT/EWKT via
  ST_GeomFromText/EWKT (emit SQL that does so), freshness gate (row count within ±5% of ~583,617 AND S3
  Last-Modified newer than last run), soft-retire missing accounts (set is_active=false, retired_at).
- run.ts — entry point wiring the philadelphia adapter sources through the pipeline; reads DATABASE_URL.
- test/ (vitest): GOLDEN fixtures — a per-source golden CSV/JSON with KNOWN expected join rates; assert the
  gate quarantines a below-threshold batch (does not throw/halt) and passes an at-threshold batch; assert
  the parcel_id_num decoy value does NOT yield a valid OPA join; assert spatial sources skip the parcel gate.
  Put fixtures in test/fixtures/. Pure-unit where possible (mock the DB); you MAY add a live Carto smoke test
  guarded behind an env flag (CARTO_LIVE=1) since Carto is public — but default tests must not hit network.
Run "pnpm --filter @bandbox/ingestion test" and "… typecheck" until green.`;

const TILES = `${COMMON}
YOUR DIRECTORY: packages/tiles (src/). Package name @bandbox/tiles.
Deliver:
- src/build.ts — the nightly tile build: query public.parcel (geom) + the choropleth-relevant fields from
  the DB (via the installed 'postgres' client + DATABASE_URL), emit newline-delimited GeoJSON, shell out to
  tippecanoe to produce a SINGLE parcels.pmtiles, and upload that ONE object to Supabase Storage (S3-compatible,
  via @aws-sdk/client-s3 using SUPABASE_S3_* env; forcePathStyle: true). Runs AFTER derived-refresh. No dynamic ST_AsMVT base map.
- src/geoBoundaries.ts — build tiny static GeoJSON/PMTiles for the aggregate boundaries (zip, neighborhood,
  tract) from public.geo_boundary.
- src/index.ts — exports buildParcelTiles(), buildBoundaryTiles().
- A comment block documenting the tippecanoe flags used and that tippecanoe must be installed in the CI/runner
  image. Guard the shell-out so a missing tippecanoe fails loudly with an actionable message.
Run "pnpm --filter @bandbox/tiles typecheck" until green (no network/DB in tests; keep any test pure).`;

const wave2 = await parallel([
  () => agent(INGESTION, { label: 'build:ingestion', phase: 'Dependent build', schema: BUILD_SCHEMA }),
  () => agent(TILES, { label: 'build:tiles', phase: 'Dependent build', schema: BUILD_SCHEMA }),
]);

// ============================ WAVE 3 — ADVERSARIAL GATES ======================
phase('Adversarial gates');

const SKEPTIC = `You are an adversarial verification skeptic. You did NOT write this code and you do
not trust it. Your job is to BREAK it with golden fixtures and edge cases, then report. Read the actual
implementation files and the tests. Run the package's tests yourself. Construct NEW hostile cases the
author may not have covered. Default to FAIL/partial if an invariant is unproven. Be specific and
evidence-based. Return ONLY the schema object.`;

const gateResults = await parallel([
  () => agent(`${SKEPTIC}
GATE: norm_parcel normalizer (PRD §3.1). Verify SQL (packages/db/migrations), core normParcelKey
(packages/core/src/adapters/philadelphia.ts), and ingestion normParcel.ts ALL agree. Hostile cases that
MUST behave correctly: '12345'→'000012345'; '000012345'→'000012345'; a 9-digit string with dashes/spaces
→ stripped then validated; a 10+-digit value (e.g. the L&I parcel_id_num decoy) → NULL + quarantined (must
NOT silently truncate into a colliding 9-digit OPA); ''/null/undefined → NULL; non-numeric → NULL. Confirm
quarantine + malformed_key_count are actually written. Confirm NOTHING joins on parcel_id_num anywhere
(grep). Run core + ingestion tests.`, { label: 'gate:norm_parcel', phase: 'Adversarial gates', schema: GATE_SCHEMA }),

  () => agent(`${SKEPTIC}
GATE: per-source join-rate gate (PRD §3.1/§4.3). Read packages/ingestion/src/joinRate.ts + pipeline.ts +
adapters + tests. Verify: gate is PER-SOURCE from the adapter baseline (not a uniform 98%); a below-threshold
batch QUARANTINES + ALERTS and does NOT halt the run (gate ≠ halt); spatial sources (crime/311, no
expectedJoinRate) are EXEMPT from the parcel-join gate and instead validate geom; BOTH parcel_number and pin
key paths are measured for RTT. Build a hostile fixture where a batch is just under threshold and confirm it
lands in quarantine + the run continues. Run the ingestion tests.`, { label: 'gate:join_rate', phase: 'Adversarial gates', schema: GATE_SCHEMA }),

  () => agent(`${SKEPTIC}
GATE: distress composite + comps math (PRD §5.3, §5.2). Read packages/core/src/scoring/* and comps/* and
tests. Assert: Σ weights = 1 (to 1e-9); EVERY component normalize maps into [0,1] for extreme inputs
(0, huge, negative, null); composite score01 ∈ [0,1] for random inputs; the emitted decomposition matches
the DistressComponent contract field-for-field and contribution = weight*normalized; weightsVersion present.
For comps: N≥5 floor enforced with deterministic widening; <5 → insufficient empty state (estimate null,
never a low-confidence number); p5/p95 trim removes outliers and reports trimmed_count; null/zero
livable_area → land branch. Throw new hostile numeric inputs at scoreDistress/selectComps via a scratch
vitest you add under packages/core/test (prefix scratch_), run it, then report. Leave the scratch test in
place only if it passes; otherwise note what failed.`, { label: 'gate:distress_comps', phase: 'Adversarial gates', schema: GATE_SCHEMA }),

  () => agent(`${SKEPTIC}
GATE: RLS / secrets (PRD §3.6, §8). Read packages/db/migrations/*.sql + infra/scripts/security-gate.mjs +
security-gate-live.mjs + .github/workflows/ci.yml. Run "node infra/scripts/security-gate.mjs". Verify EVERY
public.* table: ENABLE RLS + REVOKE INSERT/UPDATE/DELETE from anon,authenticated + GRANT SELECT to anon.
Verify app.skiptrace_key REVOKEs SELECT from anon,authenticated (encrypted_key never selectable outside a
SECURITY DEFINER proxy). Verify ops.* is NOT granted to anon/authenticated. Verify app.subscription has no
anon/authenticated write grant (service_role webhook only). Verify the CI workflow actually RUNS the live
gate against an ephemeral postgis and would FAIL the build on violation (not just warn). Grep the repo for
any committed secret-looking string (there must be none; only .env.example placeholders). Report any gap as
must_fix.`, { label: 'gate:rls_secrets', phase: 'Adversarial gates', schema: GATE_SCHEMA }),
]);

return {
  wave1: wave1.map((r, i) => ({ pkg: ['core', 'db', 'web', 'infra'][i], r })),
  wave2: wave2.map((r, i) => ({ pkg: ['ingestion', 'tiles'][i], r })),
  gates: gateResults,
};
