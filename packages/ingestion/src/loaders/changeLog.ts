/**
 * Diff → change-log / event tables (PRD §3.3) — the one irreplaceable, forward-only
 * asset (PRD §0.6). These run AFTER a source's full batch is promoted (the pipeline
 * enforces that ordering), comparing the freshly-promoted canonical state against the
 * accrued history, and append the transitions.
 *
 * All SQL here targets CANONICAL tables/columns (our names — not source literals), so
 * it lives in the ingestion package. The tracked field list is a fixed in-code
 * allowlist (never user input), so interpolating it is safe. Everything is set-based
 * (no per-row round-trips) and IDEMPOTENT: re-running the same state appends nothing.
 */
import type { DbClient } from '../db.js';

/**
 * Parcel fields tracked in `parcel_change_log` (PRD §3.3). The alert-relevant set:
 * owner change, value trend, and last sale. Extend additively — adding a field just
 * starts a new baseline series at the next run.
 */
export const PARCEL_CHANGE_LOG_FIELDS = ['owner_1', 'market_value', 'sale_price', 'sale_date'] as const;

/** A canonical column name we are allowed to diff (guards the interpolation). */
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Build the baseline-aware diff INSERT for ONE tracked field (PRD §3.3).
 *
 * BASELINE CONVENTION: the first observation of (parcel_pk, field) writes
 * old_value = NULL (no prior row → `latest.new_value` is NULL), new_value = current,
 * changed_on = today. Thereafter a row is written ONLY when the current value differs
 * from the latest logged value (a transition: old = latest, new = current). Equal
 * values write nothing. NULL current values are not logged (we record observed
 * values, not clears) — `IS DISTINCT FROM` makes NULL-vs-value a real change.
 */
export function buildFieldChangeLogSql(sourceTable: string, keyColumn: string, field: string): string {
  if (!SAFE_IDENT.test(keyColumn) || !SAFE_IDENT.test(field)) {
    throw new Error(`unsafe identifier in change-log diff: ${keyColumn}/${field}`);
  }
  return `insert into public.parcel_change_log (parcel_pk, field, old_value, new_value, changed_on)
select s.${keyColumn} as parcel_pk, '${field}' as field, latest.new_value as old_value,
       s.${field}::text as new_value, current_date as changed_on
from ${sourceTable} s
left join lateral (
  select cl.new_value
  from public.parcel_change_log cl
  where cl.parcel_pk = s.${keyColumn} and cl.field = '${field}'
  order by cl.changed_on desc, cl.id desc
  limit 1
) latest on true
where s.${keyColumn} is not null
  and s.is_active = true
  and s.${field} is not null
  and latest.new_value is distinct from s.${field}::text`;
}

/**
 * Run the parcel change-log diff across all tracked fields. Returns the number of
 * change-log rows written (baselines on first run, transitions thereafter).
 */
export async function runParcelChangeLog(
  db: DbClient,
  sourceTable = 'public.parcel',
  keyColumn = 'parcel_pk',
  fields: readonly string[] = PARCEL_CHANGE_LOG_FIELDS,
): Promise<number> {
  let written = 0;
  for (const field of fields) {
    const sql = `with ins as (${buildFieldChangeLogSql(sourceTable, keyColumn, field)} returning 1)
                 select count(*)::int as n from ins`;
    const rows = (await db.unsafe(sql)) as readonly { n: number }[];
    written += Number(rows[0]?.n ?? 0);
  }
  return written;
}

// ── delinquency_event (PRD §3.3) ──────────────────────────────────────────────
//
// appeared / reappeared / cleared, derived by comparing the current tax_delinquency
// snapshot against each parcel's standing (its latest event). Standing flags
// (is_actionable, sheriff_sale, total_due) are stored on every event for audit.

/** (Re)appearances: parcels delinquent now but NOT currently standing. */
const DELINQUENCY_APPEARED_SQL = `with standing as (
  select distinct on (parcel_pk) parcel_pk, event_type
  from public.delinquency_event
  order by parcel_pk, observed_on desc, id desc
),
current_del as (
  select parcel_pk,
         max(total_due) as total_due,
         bool_or(is_actionable) as is_actionable,
         bool_or(sheriff_sale) as sheriff_sale
  from public.tax_delinquency
  where parcel_pk is not null
  group by parcel_pk
),
ever as (select distinct parcel_pk from public.delinquency_event)
insert into public.delinquency_event (parcel_pk, event_type, total_due, is_actionable, sheriff_sale, observed_on)
select c.parcel_pk,
       case when e.parcel_pk is null then 'appeared' else 'reappeared' end,
       c.total_due, c.is_actionable, c.sheriff_sale, current_date
from current_del c
left join standing s on s.parcel_pk = c.parcel_pk and s.event_type in ('appeared', 'reappeared')
left join ever e on e.parcel_pk = c.parcel_pk
where s.parcel_pk is null`;

/** Clears: parcels currently standing but absent from the current snapshot. */
const DELINQUENCY_CLEARED_SQL = `with standing as (
  select distinct on (parcel_pk) parcel_pk, event_type
  from public.delinquency_event
  order by parcel_pk, observed_on desc, id desc
),
current_del as (
  select distinct parcel_pk from public.tax_delinquency where parcel_pk is not null
)
insert into public.delinquency_event (parcel_pk, event_type, total_due, is_actionable, sheriff_sale, observed_on)
select s.parcel_pk, 'cleared', null, false, false, current_date
from standing s
left join current_del c on c.parcel_pk = s.parcel_pk
where s.event_type in ('appeared', 'reappeared') and c.parcel_pk is null`;

/** Run the delinquency-event diff (appeared/reappeared, then cleared). Returns rows written. */
export async function runDelinquencyEventDiff(db: DbClient): Promise<number> {
  let n = 0;
  for (const sql of [DELINQUENCY_APPEARED_SQL, DELINQUENCY_CLEARED_SQL]) {
    const rows = (await db.unsafe(
      `with ins as (${sql} returning 1) select count(*)::int as n from ins`,
    )) as readonly { n: number }[];
    n += Number(rows[0]?.n ?? 0);
  }
  return n;
}

// ── violation_event (PRD §3.3) ────────────────────────────────────────────────
//
// Standing pattern keyed on violation_id. A violation is "open" when its status is
// not a closed/resolved state. appeared/reappeared when an open violation is not
// currently standing; cleared when a standing violation is now closed or absent.

/** A violation row is OPEN unless its status is a terminal state. */
const VIOLATION_OPEN_PRED = `upper(coalesce(v.status, '')) not in ('CLOSED', 'COMPLIED', 'RESOLVED')`;

const VIOLATION_APPEARED_SQL = `with standing as (
  select distinct on (violation_id) violation_id, event_type
  from public.violation_event
  order by violation_id, observed_on desc, id desc
),
ever as (select distinct violation_id from public.violation_event)
insert into public.violation_event (parcel_pk, violation_id, event_type, is_actionable, is_open, observed_on)
select v.parcel_pk, v.violation_id,
       case when e.violation_id is null then 'appeared' else 'reappeared' end,
       v.is_hazardous, true, current_date
from public.violation v
left join standing s on s.violation_id = v.violation_id and s.event_type in ('appeared', 'reappeared')
left join ever e on e.violation_id = v.violation_id
where v.violation_id is not null and v.parcel_pk is not null and ${VIOLATION_OPEN_PRED} and s.violation_id is null`;

const VIOLATION_CLEARED_SQL = `with standing as (
  select distinct on (violation_id) violation_id, event_type
  from public.violation_event
  order by violation_id, observed_on desc, id desc
),
closed_now as (
  select v.violation_id, v.parcel_pk
  from public.violation v
  where v.violation_id is not null and v.parcel_pk is not null and not (${VIOLATION_OPEN_PRED})
)
insert into public.violation_event (parcel_pk, violation_id, event_type, is_actionable, is_open, observed_on)
select c.parcel_pk, c.violation_id, 'cleared', false, false, current_date
from standing s
join closed_now c on c.violation_id = s.violation_id
where s.event_type in ('appeared', 'reappeared')`;

/** Run the violation-event diff (appeared/reappeared, then cleared). Returns rows written. */
export async function runViolationEventDiff(db: DbClient): Promise<number> {
  let n = 0;
  for (const sql of [VIOLATION_APPEARED_SQL, VIOLATION_CLEARED_SQL]) {
    const rows = (await db.unsafe(
      `with ins as (${sql} returning 1) select count(*)::int as n from ins`,
    )) as readonly { n: number }[];
    n += Number(rows[0]?.n ?? 0);
  }
  return n;
}
