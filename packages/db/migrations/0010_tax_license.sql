-- 0010_tax_license.sql
-- The three canonical tables the M1 sources promote into but 0004 did not create:
-- public.tax_delinquency, public.tax_balance, public.business_license. Shapes are
-- ground-truthed against the live Carto sources (docs/DATA_SOURCES.md; live-verified
-- 2026-06-18). parcel_pk is nullable with NO physical FK — integrity is the per-source
-- join gate (PRD §3.1/§3.2), identical to the other high-volume historical tables.
-- No lat/lng — coords live in geometry(...,4326). RLS + GRANT matrix applied here per
-- table (the security gate grades these statements; 0009's loop also re-covers them
-- on a live introspection). The worker writes as service_role (BYPASSRLS).

-- ───────────────────────────────────────────────────────────────────────────
-- public.tax_delinquency — real_estate_tax_delinquencies (current monthly snapshot,
-- ~54K rows; key opa_number). PK is the raw OPA id + snapshot stamp so re-ingesting
-- the same vintage is idempotent. Diff → public.delinquency_event (PRD §3.3).
-- Source type hazards (parsed in the adapter): is_actionable/payment_agreement are
-- text 'true'/'false'; sheriff_sale is text 'Y'/'N' — DISTINCT encodings.
-- ───────────────────────────────────────────────────────────────────────────
create table public.tax_delinquency (
  delinquency_pk         text primary key,       -- raw opa_number || '-' || year_month
  cartodb_id             bigint,
  parcel_pk              text,                    -- nullable; norm(opa_number); NO FK
  opa_number             text,                    -- raw source OPA id (traceability)
  total_due              numeric,
  principal_due          numeric,
  interest_due           numeric,
  penalty_due            numeric,
  other_charges_due      numeric,
  is_actionable          boolean not null default false,
  payment_agreement      boolean not null default false,
  sheriff_sale           boolean not null default false,
  num_years_delinquent   integer,
  most_recent_year_owed  integer,
  oldest_year_owed       integer,
  most_recent_payment_date timestamptz,
  total_assessment       numeric,
  address                text,
  zip                    text,
  owner_1                text,
  owner_2                text,
  mailing_address        text,
  mailing_state          text,
  is_out_of_state_owner  boolean not null default false,
  building_category      text,
  geom                   geometry(Point, 4326),
  year_month             text,                    -- snapshot vintage e.g. '202206'
  ingested_at            timestamptz not null default now(),
  source_updated_at      timestamptz
);
create index if not exists tax_delinquency_parcel_pk_idx on public.tax_delinquency (parcel_pk);
create index if not exists tax_delinquency_sheriff_idx    on public.tax_delinquency (sheriff_sale) where sheriff_sale;
create index if not exists tax_delinquency_actionable_idx on public.tax_delinquency (is_actionable) where is_actionable;
create index if not exists tax_delinquency_geom_gix       on public.tax_delinquency using gist (geom);

comment on table public.tax_delinquency is
  'Real-estate tax delinquency snapshot (PRD §3.2/§3.3). parcel_pk nullable, no FK '
  '(integrity via join gate). Diff → delinquency_event. year_month = snapshot vintage.';

-- ───────────────────────────────────────────────────────────────────────────
-- public.tax_balance — real_estate_tax_balances (~684K rows; one row per
-- (parcel, tax_period); key parcel_number). PK is parcel+period+lien so re-ingest
-- is idempotent across Carto reloads (cartodb_id is not stable).
-- ───────────────────────────────────────────────────────────────────────────
create table public.tax_balance (
  balance_id         text primary key,            -- parcel_number||'-'||tax_period||'-'||lien
  cartodb_id         bigint,
  parcel_pk          text,                         -- nullable; norm(parcel_number); NO FK
  tax_period         integer,                      -- tax year
  principal          numeric,
  interest           numeric,
  penalty            numeric,
  other              numeric,
  total              numeric,
  owner              text,
  location           text,
  unit               text,
  lien_number        text,                         -- distress signal; empty when no lien
  ingested_at        timestamptz not null default now(),
  source_updated_at  timestamptz
);
create index if not exists tax_balance_parcel_pk_idx on public.tax_balance (parcel_pk);
create index if not exists tax_balance_period_idx     on public.tax_balance (tax_period);
create index if not exists tax_balance_lien_idx        on public.tax_balance (lien_number) where lien_number is not null;

comment on table public.tax_balance is
  'Real-estate tax balances by parcel + tax_period (PRD §3.2). parcel_pk nullable, no FK. '
  'lien_number presence is a standing distress signal.';

-- ───────────────────────────────────────────────────────────────────────────
-- public.business_license — business_licenses (~431K rows; key opa_account_num,
-- frequently NULL for non-addressed licenses). Rental = licensetype 'Rental'.
-- PK = source license number (stable; cartodb_id is not).
-- ───────────────────────────────────────────────────────────────────────────
create table public.business_license (
  license_id              text primary key,        -- source license number
  cartodb_id              bigint,
  parcel_pk               text,                     -- nullable (many non-addressed); NO FK
  licensetype             text,
  license_status          text,
  business_name           text,
  rental_category         text,
  number_of_units         numeric,
  owner_occupied          text,                     -- source 'Yes'/'No' kept raw
  opa_owner               text,
  address                 text,
  zip                     text,
  business_mailing_address text,
  issue_date              date,
  most_recent_issue_date  date,
  expire_date             date,
  inactive_date           date,
  is_rental               boolean not null default false,
  ingested_at             timestamptz not null default now(),
  source_updated_at       timestamptz
);
create index if not exists business_license_parcel_pk_idx on public.business_license (parcel_pk);
create index if not exists business_license_rental_idx     on public.business_license (is_rental) where is_rental;
create index if not exists business_license_status_idx     on public.business_license (license_status);

comment on table public.business_license is
  'L&I business/rental licenses (PRD §3.2). parcel_pk nullable (non-addressed licenses), no FK. '
  'is_rental derived from licensetype.';

-- ───────────────────────────────────────────────────────────────────────────
-- RLS + GRANT matrix (PRD §3.6) — same shape 0008 applies to every public.* table:
-- enable RLS, permissive SELECT policy, REVOKE ALL from anon+authenticated, GRANT SELECT.
-- The static security gate grades these statements; the worker (service_role) bypasses RLS.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.tax_delinquency enable row level security;
drop policy if exists tax_delinquency_public_read on public.tax_delinquency;
create policy tax_delinquency_public_read on public.tax_delinquency for select using (true);
revoke all on public.tax_delinquency from anon, authenticated;
grant select on public.tax_delinquency to anon, authenticated;

alter table public.tax_balance enable row level security;
drop policy if exists tax_balance_public_read on public.tax_balance;
create policy tax_balance_public_read on public.tax_balance for select using (true);
revoke all on public.tax_balance from anon, authenticated;
grant select on public.tax_balance to anon, authenticated;

alter table public.business_license enable row level security;
drop policy if exists business_license_public_read on public.business_license;
create policy business_license_public_read on public.business_license for select using (true);
revoke all on public.business_license from anon, authenticated;
grant select on public.business_license to anon, authenticated;
