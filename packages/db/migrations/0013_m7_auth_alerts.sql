-- 0013_m7_auth_alerts.sql
-- M7 — accounts + alerts (free; no payments). Three additive, CI-safe changes to
-- the app.* surface (PRD §3.5, §6, §7). NOTHING here references auth.users or the
-- supabase_vault extension, so the live security gate (which runs these migrations
-- against a bare PostGIS in CI, no Supabase auth/vault present) still passes — the
-- auth.uid() shim from 0007 supplies the owner-policy predicate. Vault encryption
-- of BYO skip-trace keys happens at RUNTIME in the privileged route against the real
-- Supabase project (vault.create_secret / vault.decrypted_secrets); the column added
-- here just records which Vault secret holds a user's key.
--
--   1. app.skiptrace_key.vault_secret_id — the Vault secret id for the BYO key
--      (NULL ⇒ legacy/dev base64 in encrypted_key; see lib/skiptrace resolveKey).
--   2. app.skiptrace_usage — shared, DB-backed per-user daily skip-trace cap
--      (replaces the per-instance in-memory counter so the cap is global, PRD §6).
--   3. app.alert_subscription.unsub_token — opaque per-subscription unsubscribe
--      token carried in the List-Unsubscribe link + /api/unsubscribe (CAN-SPAM).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Vault secret id for the stored BYO skip-trace key. Additive + nullable so
--    existing rows (there are none) and dev base64 keys keep working.
-- ───────────────────────────────────────────────────────────────────────────
alter table app.skiptrace_key
  add column if not exists vault_secret_id uuid;

comment on column app.skiptrace_key.vault_secret_id is
  'Supabase Vault secret id holding the plaintext BYO key (PRD §6). NULL ⇒ the '
  'legacy/dev value in encrypted_key (base64). Decrypt happens only in the '
  'privileged route via vault.decrypted_secrets, never client-side.';

-- 1b. Denormalize the user's email onto app.profile. The nightly alert worker
--     connects as phillybricks_worker (no auth.users privilege by design), so the
--     digest reads the recipient from app.profile, not the auth schema. Captured at
--     request time from the validated session (lib/auth ensureProfile).
alter table app.profile
  add column if not exists email text;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. app.skiptrace_usage — global per-user daily cap. One row per (user, UTC day);
--    the route bumps n inside the same request that fires the lookup. RLS owner-only
--    (mirrors every app.* table); the route writes via the privileged connection.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.skiptrace_usage (
  user_id  uuid not null,
  day      date not null,                  -- UTC calendar day
  n        integer not null default 0,     -- successful lookups that day
  primary key (user_id, day)
);

alter table app.skiptrace_usage enable row level security;

drop policy if exists skiptrace_usage_owner_only on app.skiptrace_usage;
create policy skiptrace_usage_owner_only on app.skiptrace_usage
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Owner may read its own counter; writes come from the privileged route (the web
-- worker connection, RLS-exempt). anon gets nothing.
grant select, insert, update, delete on app.skiptrace_usage to authenticated;
revoke all on app.skiptrace_usage from anon;

-- The web app connects as phillybricks_worker (the pooler role), which the other
-- app.* tables already grant; mirror that for this new table so the route can write
-- the cap. Guarded so the gate's bare PostGIS (no such role) still applies cleanly.
do $usage_grant$
begin
  if exists (select 1 from pg_roles where rolname = 'phillybricks_worker') then
    grant select, insert, update, delete on app.skiptrace_usage to phillybricks_worker;
  end if;
end
$usage_grant$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Unsubscribe token on each alert subscription. Opaque (128-bit hex from two
--    gen_random_uuid()s — no pgcrypto dependency); UNIQUE so the link resolves one
--    subscription. Backfill existing rows, then default new ones.
-- ───────────────────────────────────────────────────────────────────────────
alter table app.alert_subscription
  add column if not exists unsub_token text;

update app.alert_subscription
  set unsub_token = replace(gen_random_uuid()::text, '-', '')
                 || replace(gen_random_uuid()::text, '-', '')
  where unsub_token is null;

alter table app.alert_subscription
  alter column unsub_token set default
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

create unique index if not exists alert_subscription_unsub_token_ux
  on app.alert_subscription (unsub_token);

comment on column app.alert_subscription.unsub_token is
  'Opaque one-click unsubscribe token (PRD §7) — carried in the List-Unsubscribe '
  'header + /api/unsubscribe link; resolving it disables this subscription.';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Widen app.saved_area.geom Polygon → MultiPolygon so a "canonical" area can
--    store a geo_boundary's MultiPolygon verbatim (a neighborhood is one), while
--    polygon/radius modes ST_Multi() their single ring. The alert intersection
--    (ST_Contains(area.geom, parcel.geom)) is identical for either type. The table
--    is empty (M7 introduces saved areas), so the type change is instant.
-- ───────────────────────────────────────────────────────────────────────────
alter table app.saved_area
  alter column geom type geometry(MultiPolygon, 4326)
  using st_multi(geom);
