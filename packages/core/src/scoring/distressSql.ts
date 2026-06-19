/**
 * Distress-signal MATVIEW DDL — generated from the SAME versioned config
 * (`DISTRESS_CONFIG`) that drives the pure `scoreDistress` scorer (PRD §3.4, §5.3).
 *
 * WHY THIS EXISTS: the parcel population is scored in SQL (so the leads filter, the
 * scan `distress_share`, and any sort-by-distress are a single `public.distress_signal`
 * read), while the per-parcel DECOMPOSITION the deep-dive renders is recomputed in TS
 * by `scoreDistress`. Two implementations of the same math is the classic drift hazard.
 * We remove it by GENERATING the matview's composite from the one config:
 *   - `normalizeSql()`     — the SQL form of a component's [0,1] transform.
 *   - `normalizeNumeric()` — the IDENTICAL transform in JS (the test twin).
 *   - `buildDistressSignalDDL()` — the full `create materialized view …` statement.
 * `distressSql.test.ts` then proves (a) `normalizeNumeric` === `scoreDistress`'s
 * per-component `normalized` and composite, and (b) the live migration embeds exactly
 * `buildDistressSignalDDL()`. A live spot-check (read matview → `scoreDistress` →
 * compare) closes the loop against the deployed SQL on real parcels.
 *
 * The raw-signal CTEs reference ONLY canonical (generic) relation/column names — no
 * Philly SOURCE literal — so this file is portable and lives in core beside the config.
 */
import type { DistressComponentKey } from '../contracts/index.js';
import {
  DISTRESS_CONFIG,
  DISTRESS_COMPONENT_KEYS,
  type DistressConfig,
  type NormalizeDescriptor,
} from './config.js';

/**
 * SQL [0,1] normalization for one component, over a raw SQL expression `col`.
 * MUST stay identical to `normalizeNumeric` (and to `normalizeRaw` in distress.ts):
 *   boolean    → case when <col> then 1 else 0 end
 *   linear_cap → clamp(<col>, 0, cap) / cap   ( = clamp01(col/cap) )
 */
export function normalizeSql(col: string, desc: NormalizeDescriptor): string {
  if (desc.kind === 'boolean') {
    return `(case when ${col} then 1.0 else 0.0 end)`;
  }
  // linear_cap: least(greatest(coalesce(col,0),0), cap) / cap  ∈ [0,1]
  return `(least(greatest(coalesce(${col}, 0)::numeric, 0), ${desc.cap}) / ${desc.cap}::numeric)`;
}

/**
 * The JS twin of `normalizeSql` — the SAME formula, evaluated numerically. The test
 * asserts this equals `scoreDistress`'s per-component `normalized`, tying the SQL math
 * to the frozen scoring contract.
 */
export function normalizeNumeric(
  raw: number | boolean | null | undefined,
  desc: NormalizeDescriptor,
): number {
  if (desc.kind === 'boolean') {
    if (raw === null || raw === undefined) return 0;
    return (typeof raw === 'boolean' ? raw : raw !== 0) ? 1 : 0;
  }
  const n = raw === null || raw === undefined ? 0 : typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
  if (!Number.isFinite(n) || desc.cap <= 0) return 0;
  const clamped = Math.min(Math.max(n, 0), desc.cap);
  return clamped / desc.cap;
}

/** Σ weight·normalizeNumeric over all components — the JS twin of the matview `score01`. */
export function compositeNumeric(
  signals: Partial<Record<DistressComponentKey, number | boolean | null>>,
  config: DistressConfig = DISTRESS_CONFIG,
): number {
  let s = 0;
  for (const key of DISTRESS_COMPONENT_KEYS) {
    s += config.components[key].weight * normalizeNumeric(signals[key] ?? null, config.components[key].normalize);
  }
  return Math.min(Math.max(s, 0), 1);
}

/**
 * Raw SQL expression (over the `raw_signals` CTE below) for each component. These are
 * the UNTRANSFORMED public-record figures `scoreDistress` expects as its `signals`.
 * The column name in the matview equals the `DistressComponentKey` so a downstream
 * reader builds a `DistressSignalInput.signals` map directly from a matview row.
 */
const RAW_COLUMN: Record<DistressComponentKey, string> = {
  tax_delinquent: 'tax_delinquent',
  actionable_sheriff_flag: 'actionable_sheriff_flag',
  open_violations: 'open_violations',
  unsafe_or_imm_dang: 'unsafe_or_imm_dang',
  recent_complaints: 'recent_complaints',
  on_sheriff_list: 'on_sheriff_list',
  out_of_state_owner: 'out_of_state_owner',
  vacancy_proxy: 'vacancy_proxy',
  below_market_last_sale: 'below_market_last_sale',
};

/** The composite `score01` SQL expression: Σ weight·normalizeSql(raw_column). */
export function distressCompositeSql(config: DistressConfig = DISTRESS_CONFIG): string {
  return DISTRESS_COMPONENT_KEYS.map((key) => {
    const cfg = config.components[key];
    return `${cfg.weight} * ${normalizeSql(RAW_COLUMN[key], cfg.normalize)}`;
  }).join('\n    + ');
}

/**
 * The full `create materialized view public.distress_signal … with no data;` statement,
 * generated from `config`. One row per ACTIVE parcel: the 9 raw signals + the composite
 * `score01`/`score100` + the `weights_version` that produced them.
 *
 * Signal semantics (documented; all over canonical tables):
 *   tax_delinquent          — latest tax_delinquency snapshot `total_due` (dollars).
 *   actionable_sheriff_flag — that snapshot's `is_actionable` flag (boolean).
 *   open_violations         — hazard-weighted open-violation count (a hazardous open
 *                             counts twice); open = status ∉ (CLOSED,COMPLIED,RESOLVED).
 *   unsafe_or_imm_dang      — present on the unsafe / imminently-dangerous inventory.
 *   recent_complaints       — complaints in the trailing 12 months (count).
 *   on_sheriff_list         — on an ACTIVE sheriff listing (sale_status preview|postponed)
 *                             — the M2 follow-up filter so a future 'sold'/'cancelled'
 *                             page value never over-flags distress.
 *   out_of_state_owner      — parcel owner mailing state ≠ PA.
 *   vacancy_proxy           — open vacancy-type violation OR on the demolition inventory
 *                             OR a recent vacancy complaint (best-effort proxy).
 *   below_market_last_sale  — SCAN proxy: last arms-length sale vs neighborhood median
 *                             $/sqft × livable_area, as a downward fraction (the precise
 *                             comps-based judgment is the deep-dive's, PRD §5.2/§5.3).
 */
export function buildDistressSignalDDL(config: DistressConfig = DISTRESS_CONFIG): string {
  const composite = distressCompositeSql(config);
  return `create materialized view public.distress_signal as
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
  round((${composite})::numeric, 6) as score01,
  round((${composite})::numeric * 100)::int as score100,
  '${config.version}' as weights_version,
  now() as computed_at
from raw_signals
with no data;`;
}
