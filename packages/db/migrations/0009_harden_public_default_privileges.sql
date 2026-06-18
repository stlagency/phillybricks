-- 0009_harden_public_default_privileges.sql
-- Supabase grants TRUNCATE/REFERENCES/TRIGGER/SELECT to anon+authenticated on every
-- new table in `public` via schema DEFAULT PRIVILEGES. RLS blocks DML, but TRUNCATE
-- BYPASSES RLS — so a default-privilege TRUNCATE grant is a real exposure that a
-- bare-PostGIS CI run never reproduces (only a live Supabase introspection catches
-- it). Lock the grant layer down for OUR relations: REVOKE ALL, then GRANT SELECT.
--
-- Loops over base tables, partitioned tables, and matviews in `public`. PostGIS
-- system relations (spatial_ref_sys, geometry_columns, geography_columns) are owned
-- by the extension/superuser and are NOT revocable by the migration role — they are
-- extension plumbing (read-only views + public EPSG reference data), excluded here
-- and in infra/scripts/security-gate-live.mjs. Idempotent.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'm')
      and c.relname not in ('spatial_ref_sys', 'geometry_columns', 'geography_columns')
  loop
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
    execute format('grant select on public.%I to anon, authenticated', r.relname);
  end loop;
end
$$;
