-- 0014_m7_skiptrace_vault_proxy.sql
-- M7 — the SECURITY DEFINER skip-trace key proxy (PRD §6). The web connection role
-- (phillybricks_worker) has NO Vault privilege by design: a BYO key is encrypted/
-- decrypted ONLY inside these functions, which run as their owner (a Vault-capable
-- role) and encapsulate vault.create_secret / vault.decrypted_secrets. The worker can
-- store + resolve its own key without being able to read the Vault generally.
--
-- CI-safe: the bodies are plpgsql (name resolution is deferred to first execution),
-- so they CREATE cleanly on the gate's bare PostGIS where the vault schema is absent;
-- they simply never run there. The EXECUTE grant is guarded on the role existing.
--
-- PROD NOTE: apply as a Vault-capable role (the Supabase `postgres` role, e.g. via
-- the MCP) so the functions are OWNED by it — SECURITY DEFINER then has Vault access.
-- (phillybricks_worker cannot create app.* objects, so prod is migrated as postgres.)

-- ── store: replace any prior key, encrypt the new one into Vault ──────────────
create or replace function app.set_skiptrace_key(p_user_id uuid, p_vendor text, p_plaintext text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare sid uuid;
begin
  perform app.delete_skiptrace_key(p_user_id);
  select vault.create_secret(p_plaintext) into sid;
  insert into app.skiptrace_key (user_id, vendor, encrypted_key, vault_secret_id)
  values (p_user_id, p_vendor, 'vault', sid);
end;
$fn$;

-- ── resolve: {vendor, plaintext} for the user's key, decrypted in-function ────
create or replace function app.get_skiptrace_key(p_user_id uuid)
returns table(r_vendor text, r_plaintext text)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return query
    select k.vendor,
           coalesce(
             (select d.decrypted_secret from vault.decrypted_secrets d where d.id = k.vault_secret_id),
             k.encrypted_key
           )
    from app.skiptrace_key k
    where k.user_id = p_user_id
    limit 1;
end;
$fn$;

-- ── delete: drop the user's key row + its Vault secret ────────────────────────
create or replace function app.delete_skiptrace_key(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare r record;
begin
  for r in
    select vault_secret_id from app.skiptrace_key
    where user_id = p_user_id and vault_secret_id is not null
  loop
    begin
      delete from vault.secrets where id = r.vault_secret_id;
    exception when others then
      null; -- no Vault (self-host) or already gone — non-fatal
    end;
  end loop;
  delete from app.skiptrace_key where user_id = p_user_id;
end;
$fn$;

-- ── privileges: no PUBLIC execute; only the web worker role may call ──────────
revoke all on function app.set_skiptrace_key(uuid, text, text) from public;
revoke all on function app.get_skiptrace_key(uuid)             from public;
revoke all on function app.delete_skiptrace_key(uuid)          from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'phillybricks_worker') then
    grant execute on function app.set_skiptrace_key(uuid, text, text) to phillybricks_worker;
    grant execute on function app.get_skiptrace_key(uuid)             to phillybricks_worker;
    grant execute on function app.delete_skiptrace_key(uuid)          to phillybricks_worker;
  end if;
end
$grants$;
