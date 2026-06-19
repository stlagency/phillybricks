-- 0011_m3_derived.sql  (M3 — derived analytics, PRD §3.4 / §5.2 / §5.3)
--
-- Replaces the structurally-correct PLACEHOLDER matview bodies from 0006 with the
-- real selection/scoring SQL, now that the warehouse holds real data (OPA spine
-- 583,617 parcels; RTT 5.1M transfers / 709K arms-length; tax/violations/sheriff
-- live). What changes here:
--   1. public.geo_boundary.geom → MultiPolygon (the neighborhood source is
--      MultiPolygon; ZIP/tract are Polygon and get ST_Multi'd on load).
--   2. public.comp_candidate — recreated with `address` for comp display.
--   3. public.distress_signal — recreated with the REAL composite. Its body is
--      GENERATED from packages/core's versioned DISTRESS_CONFIG (the same artifact
--      scoreDistress uses) by scripts/print-distress-sql.ts, embedded VERBATIM
--      between the GENERATED markers. distressSql.test.ts fails CI if this block
--      drifts from the generator; regenerate with:
--        pnpm --filter @bandbox/core exec tsx scripts/print-distress-sql.ts
--   4. Matview ownership → phillybricks_worker (guarded by a role-exists check so the
--      migration stays portable: the CI ephemeral PostGIS has no such role and skips
--      it). Reassigning ownership is what lets the worker run REFRESH MATERIALIZED
--      VIEW CONCURRENTLY directly (a SECURITY DEFINER wrapper can't — CONCURRENTLY
--      may not run inside a function/transaction). PG16 blocks `grant postgres`, so
--      we reassign DOWN to the worker rather than up (NEXT_SESSION gotcha).
--
-- Matviews carry NO RLS — access is GRANT SELECT only (re-granted here because DROP
-- drops the grants). DROP order: distress_signal first (the new one depends on
-- comp_candidate), then comp_candidate, then recreate comp_candidate, then
-- distress_signal. REFRESH ... CONCURRENTLY needs the UNIQUE indexes (recreated here)
-- and a one-time non-concurrent populate first (done by the worker, not here).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. geo_boundary.geom → MultiPolygon(4326). Idempotent: only alters if the
--    column is still POLYGON (re-runs are a no-op). Table is empty pre-load.
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.geometry_columns
    where f_table_schema = 'public' and f_table_name = 'geo_boundary' and type = 'POLYGON'
  ) then
    alter table public.geo_boundary
      alter column geom type geometry(MultiPolygon, 4326) using ST_Multi(geom);
  end if;
end
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Recreate matviews with real bodies. Drop the dependent (distress_signal)
--    first, then comp_candidate.
-- ───────────────────────────────────────────────────────────────────────────
drop materialized view if exists public.distress_signal;
drop materialized view if exists public.comp_candidate;

-- public.comp_candidate — arms-length sales usable as comps (PRD §3.4/§5.2).
-- UNIQUE(transfer_id) grain enables CONCURRENTLY refresh. Adds `address` for display.
create materialized view public.comp_candidate as
  select
    t.transfer_id                                          as transfer_id,
    t.parcel_pk                                            as parcel_pk,
    p.address                                              as address,
    t.recording_date                                       as sale_date,
    t.total_consideration                                  as sale_price,
    p.geom                                                 as geom,
    p.livable_area                                         as livable_area,
    p.beds                                                 as beds,
    p.year_built                                           as year_built,
    p.category_code                                        as category_code,
    p.neighborhood_id                                      as neighborhood_id,
    case
      when p.livable_area is not null and p.livable_area > 0
      then t.total_consideration / p.livable_area
      else null
    end                                                    as price_per_sqft
  from public.transfer t
  join public.parcel p on p.parcel_pk = t.parcel_pk
  where t.is_arms_length
    and t.parcel_pk is not null
    and t.total_consideration is not null
    and t.total_consideration > 0
  with no data;

create unique index if not exists comp_candidate_transfer_id_uidx
  on public.comp_candidate (transfer_id);
create index if not exists comp_candidate_geom_gix on public.comp_candidate using gist (geom);
create index if not exists comp_candidate_neighborhood_idx on public.comp_candidate (neighborhood_id);

comment on materialized view public.comp_candidate is
  'Arms-length comp candidates (PRD §3.4/§5.2). UNIQUE(transfer_id) grain enables '
  'CONCURRENTLY refresh. No RLS — access is GRANT-only.';

-- public.distress_signal — one row per active parcel; composite GENERATED from
-- packages/core DISTRESS_CONFIG. Depends on comp_candidate (neighborhood median
-- $/sqft for the below-market scan proxy), created above.
-- BEGIN GENERATED distress_signal (scripts/print-distress-sql.ts — do not hand-edit)
create materialized view public.distress_signal as
with
  tax as (
    select distinct on (parcel_pk)
      parcel_pk, total_due, is_actionable
    from public.tax_delinquency
    where parcel_pk is not null
    order by parcel_pk, year_month desc nulls last
  ),
  viol as (
    select parcel_pk,
      count(*) filter (where upper(coalesce(status,'')) not in ('CLOSED','COMPLIED','RESOLVED'))
        + count(*) filter (where upper(coalesce(status,'')) not in ('CLOSED','COMPLIED','RESOLVED') and is_hazardous)
        as weighted_open
    from public.violation
    where parcel_pk is not null
    group by parcel_pk
  ),
  inv as (
    select parcel_pk, true as has_inventory
    from public.distress_inventory
    where parcel_pk is not null
      and kind in ('unsafe','imm_dang')
      and coalesce(lower(status),'open') <> 'closed'
    group by parcel_pk
  ),
  compl as (
    select parcel_pk, count(*) as recent_count
    from public.complaint
    where parcel_pk is not null
      and complaint_date >= (current_date - interval '12 months')
    group by parcel_pk
  ),
  sher as (
    select parcel_pk, true as on_list
    from public.sheriff_listing
    where parcel_pk is not null
      and coalesce(lower(sale_status),'') in ('preview','postponed')
    group by parcel_pk
  ),
  vac as (
    select parcel_pk, true as is_vacant from (
      select parcel_pk from public.violation
        where parcel_pk is not null
          and upper(coalesce(status,'')) not in ('CLOSED','COMPLIED','RESOLVED')
          and (violation_type ilike '%vacan%' or violation_code ilike '%vacan%')
      union
      select parcel_pk from public.distress_inventory
        where parcel_pk is not null and kind = 'demolition'
      union
      select parcel_pk from public.complaint
        where parcel_pk is not null
          and complaint_type ilike '%vacan%'
          and complaint_date >= (current_date - interval '24 months')
    ) u group by parcel_pk
  ),
  hood_psf as (
    select neighborhood_id,
      percentile_cont(0.5) within group (order by price_per_sqft) as med_psf
    from public.comp_candidate
    where neighborhood_id is not null and price_per_sqft is not null and price_per_sqft > 0
    group by neighborhood_id
  ),
  last_arms as (
    select distinct on (parcel_pk) parcel_pk, total_consideration as last_price
    from public.transfer
    where is_arms_length and parcel_pk is not null
      and total_consideration is not null and total_consideration > 0
    order by parcel_pk, recording_date desc nulls last
  ),
  raw_signals as (
    select
      p.parcel_pk,
      coalesce(tax.total_due, 0)::numeric                       as tax_delinquent,
      coalesce(tax.is_actionable, false)                        as actionable_sheriff_flag,
      coalesce(viol.weighted_open, 0)::bigint                   as open_violations,
      coalesce(inv.has_inventory, false)                        as unsafe_or_imm_dang,
      coalesce(compl.recent_count, 0)::bigint                   as recent_complaints,
      coalesce(sher.on_list, false)                             as on_sheriff_list,
      p.is_out_of_state_owner                                   as out_of_state_owner,
      coalesce(vac.is_vacant, false)                            as vacancy_proxy,
      case
        when hp.med_psf is not null and p.livable_area > 0
             and la.last_price is not null
             and la.last_price < hp.med_psf * p.livable_area
        then least((hp.med_psf * p.livable_area - la.last_price) / (hp.med_psf * p.livable_area), 1.0)
        else 0
      end::numeric                                              as below_market_last_sale
    from public.parcel p
    left join tax       on tax.parcel_pk = p.parcel_pk
    left join viol      on viol.parcel_pk = p.parcel_pk
    left join inv       on inv.parcel_pk = p.parcel_pk
    left join compl     on compl.parcel_pk = p.parcel_pk
    left join sher      on sher.parcel_pk = p.parcel_pk
    left join vac       on vac.parcel_pk = p.parcel_pk
    left join hood_psf  hp on hp.neighborhood_id = p.neighborhood_id
    left join last_arms la on la.parcel_pk = p.parcel_pk
    where p.is_active
  )
select
  parcel_pk,
  tax_delinquent,
  actionable_sheriff_flag,
  open_violations,
  unsafe_or_imm_dang,
  recent_complaints,
  on_sheriff_list,
  out_of_state_owner,
  vacancy_proxy,
  below_market_last_sale,
  round((0.2 * (least(greatest(coalesce(tax_delinquent, 0)::numeric, 0), 25000) / 25000::numeric)
    + 0.12 * (case when actionable_sheriff_flag then 1.0 else 0.0 end)
    + 0.14 * (least(greatest(coalesce(open_violations, 0)::numeric, 0), 5) / 5::numeric)
    + 0.12 * (case when unsafe_or_imm_dang then 1.0 else 0.0 end)
    + 0.08 * (least(greatest(coalesce(recent_complaints, 0)::numeric, 0), 4) / 4::numeric)
    + 0.1 * (case when on_sheriff_list then 1.0 else 0.0 end)
    + 0.06 * (case when out_of_state_owner then 1.0 else 0.0 end)
    + 0.12 * (case when vacancy_proxy then 1.0 else 0.0 end)
    + 0.06 * (least(greatest(coalesce(below_market_last_sale, 0)::numeric, 0), 0.4) / 0.4::numeric))::numeric, 6) as score01,
  round((0.2 * (least(greatest(coalesce(tax_delinquent, 0)::numeric, 0), 25000) / 25000::numeric)
    + 0.12 * (case when actionable_sheriff_flag then 1.0 else 0.0 end)
    + 0.14 * (least(greatest(coalesce(open_violations, 0)::numeric, 0), 5) / 5::numeric)
    + 0.12 * (case when unsafe_or_imm_dang then 1.0 else 0.0 end)
    + 0.08 * (least(greatest(coalesce(recent_complaints, 0)::numeric, 0), 4) / 4::numeric)
    + 0.1 * (case when on_sheriff_list then 1.0 else 0.0 end)
    + 0.06 * (case when out_of_state_owner then 1.0 else 0.0 end)
    + 0.12 * (case when vacancy_proxy then 1.0 else 0.0 end)
    + 0.06 * (least(greatest(coalesce(below_market_last_sale, 0)::numeric, 0), 0.4) / 0.4::numeric))::numeric * 100)::int as score100,
  'distress-2026-06-18.v1' as weights_version,
  now() as computed_at
from raw_signals
with no data;
-- END GENERATED distress_signal

create unique index if not exists distress_signal_parcel_pk_uidx
  on public.distress_signal (parcel_pk);
-- Leads/scan support: a partial index over scored parcels speeds the distress filter.
create index if not exists distress_signal_score_idx
  on public.distress_signal (score01 desc) where score01 > 0;

comment on materialized view public.distress_signal is
  'Per-parcel distress composite (PRD §3.4/§5.3). UNIQUE(parcel_pk) enables CONCURRENTLY '
  'refresh. Body GENERATED from packages/core DISTRESS_CONFIG (single source of truth with '
  'scoreDistress). No RLS — access is GRANT-only.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Re-GRANT SELECT on the recreated matviews (DROP dropped the grants).
--    No RLS on matviews — access is GRANT-only (PRD §3.4/§3.6).
-- ───────────────────────────────────────────────────────────────────────────
grant select on public.comp_candidate  to anon, authenticated;
grant select on public.distress_signal to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Reassign matview ownership to the worker so it can REFRESH CONCURRENTLY.
--    Guarded by a role-exists check → portable (no-op where the role is absent,
--    e.g. the CI ephemeral PostGIS). On prod the postgres session is a member of
--    phillybricks_worker, so the reassignment succeeds.
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'phillybricks_worker') then
    -- PG16: reassigning ownership requires the current role to be able to SET ROLE
    -- to the target. Grant ourselves the SET option first (no-op if we already have
    -- it or lack ADMIN — the ALTER's own exception guard then handles a true denial).
    begin
      execute 'grant phillybricks_worker to ' || quote_ident(current_user) || ' with set true';
    exception when others then null;
    end;
    -- The new owner needs CREATE on the object's schema to own a relation there.
    begin
      grant create on schema public to phillybricks_worker;
    exception when others then null;
    end;
    begin
      alter materialized view public.comp_candidate  owner to phillybricks_worker;
      alter materialized view public.distress_signal owner to phillybricks_worker;
    exception when insufficient_privilege then
      raise notice 'skipped matview ownership reassignment — cannot SET ROLE phillybricks_worker';
    end;
  end if;
end
$$;
