-- 0007_app_user.sql
-- User data (app.*), RLS owner-only (PRD §3.5, §3.6).
-- Every app.* table: ENABLE RLS + an owner-only policy using (user_id = auth.uid()).
-- DEFERRED: Stripe postponed; app.subscription is ready but UNUSED until
-- monetization (M8). The gated surfaces are free for authenticated users today.
-- app.subscription is written ONLY by the service_role webhook (no anon/authenticated
-- write grant). app.skiptrace_key.encrypted_key must NEVER be selectable by
-- anon/authenticated (decrypt happens only inside a SECURITY DEFINER proxy, PRD §6).
--
-- auth.uid() is provided by Supabase. For a bare self-host where the auth schema
-- isn't present yet, provide a no-op shim so these migrations still apply.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;
  if not exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'auth' and pr.proname = 'uid'
  ) then
    -- Shim: real Supabase auth.uid() reads the JWT claim. Self-host returns NULL
    -- (deny-by-default under the owner-only policy) until real auth is wired.
    execute $fn$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $body$;
    $fn$;
  end if;
end
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- app.profile — one row per auth user (id = auth.uid()).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.profile (
  id          uuid primary key,             -- = auth.uid()
  user_id     uuid not null,                -- = id (owner column for the policy)
  display_name text,
  attested_skiptrace_at timestamptz,        -- per-user lawful-use attestation (PRD §8)
  created_at  timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- app.subscription — Stripe entitlement. Written ONLY by the service_role webhook.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.subscription (
  user_id              uuid primary key,
  stripe_customer_id   text,
  status               text not null default 'inactive', -- 'active' unlocks paid surfaces
  current_period_end   timestamptz,
  updated_at           timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- app.saved_area — a farm. kind resolved to a stored Polygon (PRD §3.5).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.saved_area (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text,
  kind        text not null,                -- 'polygon' | 'canonical' | 'radius'
  geom        geometry(Polygon, 4326),
  created_at  timestamptz not null default now()
);
create index if not exists saved_area_user_idx on app.saved_area (user_id);
create index if not exists saved_area_geom_gix  on app.saved_area using gist (geom);

-- ───────────────────────────────────────────────────────────────────────────
-- app.saved_lead — mini-CRM row (PRD §3.5, §7.3).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.saved_lead (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  parcel_pk   text not null,
  status      text not null default 'new',  -- new | contacted | dead | ...
  tags        text[] not null default '{}',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists saved_lead_user_idx on app.saved_lead (user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- app.alert_subscription — triggers on a saved area; last_sent_at bounds digests.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.alert_subscription (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  saved_area_id uuid,
  trigger_types text[] not null default '{}', -- new_transaction|new_development|new_distress|new_matching_lead
  channel       text not null default 'email',
  frequency     text not null default 'daily',
  last_sent_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists alert_subscription_user_idx on app.alert_subscription (user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- app.alert_event — materialized alert feed item (PRD §3.5).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.alert_event (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  parcel_pk     text,
  trigger_type  text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists alert_event_user_idx on app.alert_event (user_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- app.skiptrace_key — BYO vendor key, encrypted at rest (PRD §3.5/§3.6/§6).
-- encrypted_key must NEVER be selectable by anon/authenticated.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists app.skiptrace_key (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  vendor        text not null,               -- enum-keyed server-side allowlist (PRD §6)
  encrypted_key text not null,               -- Vault-encrypted; decrypt only in proxy
  created_at    timestamptz not null default now()
);
create index if not exists skiptrace_key_user_idx on app.skiptrace_key (user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- RLS: enable + owner-only policy on every app.* table.
-- ───────────────────────────────────────────────────────────────────────────
alter table app.profile            enable row level security;
alter table app.subscription       enable row level security;
alter table app.saved_area         enable row level security;
alter table app.saved_lead         enable row level security;
alter table app.alert_subscription enable row level security;
alter table app.alert_event        enable row level security;
alter table app.skiptrace_key      enable row level security;

-- profile keys on id (= auth.uid()); the rest key on user_id.
drop policy if exists profile_owner_only on app.profile;
create policy profile_owner_only on app.profile
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists saved_area_owner_only on app.saved_area;
create policy saved_area_owner_only on app.saved_area
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists saved_lead_owner_only on app.saved_lead;
create policy saved_lead_owner_only on app.saved_lead
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists alert_subscription_owner_only on app.alert_subscription;
create policy alert_subscription_owner_only on app.alert_subscription
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists alert_event_owner_only on app.alert_event;
create policy alert_event_owner_only on app.alert_event
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists skiptrace_key_owner_only on app.skiptrace_key;
create policy skiptrace_key_owner_only on app.skiptrace_key
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- subscription is READ-only to its owner; writes come from the service_role webhook.
drop policy if exists subscription_owner_select on app.subscription;
create policy subscription_owner_select on app.subscription
  for select using (user_id = auth.uid());

-- ───────────────────────────────────────────────────────────────────────────
-- GRANT matrix for app.* (PRD §3.6).
-- authenticated: owner-only CRUD on personal tables; SELECT-only on subscription.
-- anon: nothing.
-- skiptrace_key: REVOKE SELECT from anon + authenticated (encrypted_key never selectable).
-- ───────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on app.profile            to authenticated;
grant select, insert, update, delete on app.saved_area         to authenticated;
grant select, insert, update, delete on app.saved_lead         to authenticated;
grant select, insert, update, delete on app.alert_subscription to authenticated;
grant select, insert, update, delete on app.alert_event        to authenticated;

-- subscription: SELECT only for the owner; NO write grant (service_role webhook writes).
grant select on app.subscription to authenticated;
revoke insert, update, delete on app.subscription from anon, authenticated;

-- skiptrace_key: owner may INSERT/UPDATE/DELETE its own row, but the encrypted_key
-- must never be SELECTable by anon or authenticated — decrypt happens only inside
-- the SECURITY DEFINER proxy (PRD §6). REVOKE SELECT explicitly.
grant insert, update, delete on app.skiptrace_key to authenticated;
revoke select on app.skiptrace_key from anon, authenticated;

-- anon gets nothing in app.*.
revoke all on app.profile            from anon;
revoke all on app.subscription       from anon;
revoke all on app.saved_area         from anon;
revoke all on app.saved_lead         from anon;
revoke all on app.alert_subscription from anon;
revoke all on app.alert_event        from anon;
revoke all on app.skiptrace_key      from anon;
