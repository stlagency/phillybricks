-- 0001_extensions_schemas.sql
-- Bandbox M0/M1 — extensions + schema layout (PRD §2, §3.1).
--
-- Schemas (PRD §3.1):
--   raw.*    faithful landing, mostly transient (land-transform-discard).
--   public.* canonical + derived, anon-readable via GRANT SELECT (default schema).
--   app.*    user data, RLS owner-only.
--   ops.*    run logs, cursors, quarantine — NEVER anon-exposed.
--
-- Idempotent: safe to re-run.

create extension if not exists postgis;
-- pgcrypto provides gen_random_uuid() for app.* PKs on PG<13 / bare self-host images
-- (PG13+ ships it in core, but the extension is a harmless no-op there).
create extension if not exists pgcrypto;

create schema if not exists raw;
create schema if not exists app;
create schema if not exists ops;
-- `public` already exists in every Postgres database and is the default schema.

-- Schema-level usage. Roles (anon, authenticated, service_role) are provisioned
-- by Supabase. In a bare self-host they may not exist yet; create them no-op-safely
-- so these migrations run against a vanilla PostGIS image too (PRD §8 SELF_HOST).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- anon/authenticated may resolve names in public + app; ops is internal-only.
grant usage on schema public to anon, authenticated;
grant usage on schema app to authenticated;
-- service_role (the worker) sees everything; it bypasses RLS by role attribute.
grant usage on schema raw, public, app, ops to service_role;

-- ops + raw are never granted to anon/authenticated. (Asserted by the security gate.)
revoke all on schema ops from anon, authenticated;
revoke all on schema raw from anon, authenticated;
