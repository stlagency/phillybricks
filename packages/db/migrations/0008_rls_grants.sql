-- 0008_rls_grants.sql
-- The RLS + GRANT matrix (PRD §3.6), applied to EVERY public.* table. This is the
-- migration the security gate (infra/scripts/security-gate.mjs) grades.
--
-- For every public.* TABLE:
--   ENABLE ROW LEVEL SECURITY;
--   a permissive SELECT policy USING (true)        -- canonical data is public-readable
--   REVOKE ALL ... FROM anon, authenticated   -- read-only (also strips TRUNCATE/
--                                              -- REFERENCES/TRIGGER that Supabase
--                                              -- default-privileges grant; TRUNCATE
--                                              -- bypasses RLS, so this matters)
--   GRANT SELECT ... TO anon, authenticated
-- 0009 re-applies this as a loop to catch Supabase's schema default privileges.
-- The worker writes as service_role (BYPASSRLS) — no extra grant needed.
--
-- Matviews (distress_signal, comp_candidate) carry NO RLS; access is GRANT SELECT only.
-- geo_metric + geo_boundary are REGULAR tables and get the full matrix.

-- ── public.parcel ───────────────────────────────────────────────────────────
alter table public.parcel enable row level security;
drop policy if exists parcel_public_read on public.parcel;
create policy parcel_public_read on public.parcel for select using (true);
revoke all on public.parcel from anon, authenticated;
grant select on public.parcel to anon, authenticated;

-- ── public.transfer ─────────────────────────────────────────────────────────
alter table public.transfer enable row level security;
drop policy if exists transfer_public_read on public.transfer;
create policy transfer_public_read on public.transfer for select using (true);
revoke all on public.transfer from anon, authenticated;
grant select on public.transfer to anon, authenticated;

-- ── public.permit ───────────────────────────────────────────────────────────
alter table public.permit enable row level security;
drop policy if exists permit_public_read on public.permit;
create policy permit_public_read on public.permit for select using (true);
revoke all on public.permit from anon, authenticated;
grant select on public.permit to anon, authenticated;

-- ── public.violation ────────────────────────────────────────────────────────
alter table public.violation enable row level security;
drop policy if exists violation_public_read on public.violation;
create policy violation_public_read on public.violation for select using (true);
revoke all on public.violation from anon, authenticated;
grant select on public.violation to anon, authenticated;

-- ── public.complaint ────────────────────────────────────────────────────────
alter table public.complaint enable row level security;
drop policy if exists complaint_public_read on public.complaint;
create policy complaint_public_read on public.complaint for select using (true);
revoke all on public.complaint from anon, authenticated;
grant select on public.complaint to anon, authenticated;

-- ── public.case_investigation ───────────────────────────────────────────────
alter table public.case_investigation enable row level security;
drop policy if exists case_investigation_public_read on public.case_investigation;
create policy case_investigation_public_read on public.case_investigation for select using (true);
revoke all on public.case_investigation from anon, authenticated;
grant select on public.case_investigation to anon, authenticated;

-- ── public.distress_inventory ───────────────────────────────────────────────
alter table public.distress_inventory enable row level security;
drop policy if exists distress_inventory_public_read on public.distress_inventory;
create policy distress_inventory_public_read on public.distress_inventory for select using (true);
revoke all on public.distress_inventory from anon, authenticated;
grant select on public.distress_inventory to anon, authenticated;

-- ── public.sheriff_listing ──────────────────────────────────────────────────
alter table public.sheriff_listing enable row level security;
drop policy if exists sheriff_listing_public_read on public.sheriff_listing;
create policy sheriff_listing_public_read on public.sheriff_listing for select using (true);
revoke all on public.sheriff_listing from anon, authenticated;
grant select on public.sheriff_listing to anon, authenticated;

-- ── public.crime_incident ───────────────────────────────────────────────────
alter table public.crime_incident enable row level security;
drop policy if exists crime_incident_public_read on public.crime_incident;
create policy crime_incident_public_read on public.crime_incident for select using (true);
revoke all on public.crime_incident from anon, authenticated;
grant select on public.crime_incident to anon, authenticated;

-- ── public.service_request ──────────────────────────────────────────────────
alter table public.service_request enable row level security;
drop policy if exists service_request_public_read on public.service_request;
create policy service_request_public_read on public.service_request for select using (true);
revoke all on public.service_request from anon, authenticated;
grant select on public.service_request to anon, authenticated;

-- ── public.parcel_change_log ────────────────────────────────────────────────
alter table public.parcel_change_log enable row level security;
drop policy if exists parcel_change_log_public_read on public.parcel_change_log;
create policy parcel_change_log_public_read on public.parcel_change_log for select using (true);
revoke all on public.parcel_change_log from anon, authenticated;
grant select on public.parcel_change_log to anon, authenticated;

-- ── public.delinquency_event ────────────────────────────────────────────────
alter table public.delinquency_event enable row level security;
drop policy if exists delinquency_event_public_read on public.delinquency_event;
create policy delinquency_event_public_read on public.delinquency_event for select using (true);
revoke all on public.delinquency_event from anon, authenticated;
grant select on public.delinquency_event to anon, authenticated;

-- ── public.violation_event ──────────────────────────────────────────────────
alter table public.violation_event enable row level security;
drop policy if exists violation_event_public_read on public.violation_event;
create policy violation_event_public_read on public.violation_event for select using (true);
revoke all on public.violation_event from anon, authenticated;
grant select on public.violation_event to anon, authenticated;

-- ── public.geo_metric (regular table) ───────────────────────────────────────
alter table public.geo_metric enable row level security;
drop policy if exists geo_metric_public_read on public.geo_metric;
create policy geo_metric_public_read on public.geo_metric for select using (true);
revoke all on public.geo_metric from anon, authenticated;
grant select on public.geo_metric to anon, authenticated;

-- ── public.geo_boundary (regular table) ─────────────────────────────────────
alter table public.geo_boundary enable row level security;
drop policy if exists geo_boundary_public_read on public.geo_boundary;
create policy geo_boundary_public_read on public.geo_boundary for select using (true);
revoke all on public.geo_boundary from anon, authenticated;
grant select on public.geo_boundary to anon, authenticated;

-- ── Matviews: GRANT SELECT only (no RLS — access is GRANT-only, PRD §3.4/§3.6) ──
grant select on public.distress_signal to anon, authenticated;
grant select on public.comp_candidate  to anon, authenticated;
