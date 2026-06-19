/**
 * Incremental geo_metric recompute (PRD §3.4 / §5.4). public.geo_metric is a REGULAR
 * table, upserted on (geo_type, geo_id, period, metric) — NOT a full-recompute matview —
 * so the nightly never blocks reads and never re-aggregates 14M+ rows.
 *
 * Two explicitly-labeled classes (PRD §5.4):
 *   (a) BACKFILLABLE, event-derived → a true historical MONTHLY series keyed on the
 *       event date (sale, permit, incident). `metric_class = 'a_backfillable'`. The
 *       one-time backfill computes every month; the nightly recomputes only the
 *       trailing `trailingMonths` (cheap, and the only months that can change).
 *   (b) FORWARD-ACCRUING, state-derived → a single CURRENT-month snapshot row recomputed
 *       each run (delinquency / violation share, assessment level, the distress + the
 *       livability index). `metric_class = 'b_forward_accruing'`. The UI labels these
 *       "tracking since <first ingest>".
 *
 * The 4 scan lenses read: median_price_per_sqft (price), permit_count (momentum),
 * distress_share (distress), livability_index (livability) — see adapter.lensMetricSql.
 *
 * Only canonical relation/column names appear here — no source literal. Geo columns
 * (neighborhood_id/zip_id/tract_id) come from a fixed allowlist, never user input.
 */
import type { GeoType } from '@bandbox/core/contracts';
import type { DbClient } from '../db.js';

interface GeoCol {
  geoType: GeoType;
  col: 'neighborhood_id' | 'zip_id' | 'tract_id';
}
const GEO_COLS: GeoCol[] = [
  { geoType: 'neighborhood', col: 'neighborhood_id' },
  { geoType: 'zip', col: 'zip_id' },
  { geoType: 'tract', col: 'tract_id' },
];

const ON_CONFLICT = `on conflict (geo_type, geo_id, period, metric) do update
  set value = excluded.value, metric_class = excluded.metric_class,
      sample_size = excluded.sample_size, computed_at = excluded.computed_at`;

const COLS =
  '(geo_type, geo_id, period, metric, value, metric_class, sample_size, computed_at)';

/** Trailing-window floor on `dateCol`, or '' for a full backfill (trailingMonths null). */
function floor(dateCol: string, trailingMonths: number | null): string {
  return trailingMonths === null
    ? ''
    : `and ${dateCol} >= (current_date - interval '${trailingMonths} months')`;
}

/**
 * Class-(a) backfillable monthly metrics. Each builds an INSERT…SELECT…ON CONFLICT for
 * one (geoType, col), keyed on the EVENT date's month. `m` = trailingMonths (null =
 * full backfill).
 */
const CLASS_A: ((g: GeoCol, m: number | null) => string)[] = [
  // price lens — median arms-length $/sqft.
  ({ geoType, col }, m) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(t.recording_date,'YYYY-MM'), 'median_price_per_sqft',
      percentile_cont(0.5) within group (order by t.total_consideration / p.livable_area),
      'a_backfillable', count(*), now()
    from public.transfer t join public.parcel p on p.parcel_pk = t.parcel_pk
    where t.is_arms_length and p.${col} is not null and t.recording_date is not null
      and p.livable_area > 0 and t.total_consideration > 0 ${floor('t.recording_date', m)}
    group by p.${col}, to_char(t.recording_date,'YYYY-MM') ${ON_CONFLICT}`,
  // median sale price (trend / deep-dive).
  ({ geoType, col }, m) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(t.recording_date,'YYYY-MM'), 'median_sale_price',
      percentile_cont(0.5) within group (order by t.total_consideration),
      'a_backfillable', count(*), now()
    from public.transfer t join public.parcel p on p.parcel_pk = t.parcel_pk
    where t.is_arms_length and p.${col} is not null and t.recording_date is not null
      and t.total_consideration > 0 ${floor('t.recording_date', m)}
    group by p.${col}, to_char(t.recording_date,'YYYY-MM') ${ON_CONFLICT}`,
  // sheriff-deed share of recorded transfers (distress trend).
  ({ geoType, col }, m) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(t.recording_date,'YYYY-MM'), 'sheriff_deed_share',
      avg(case when t.is_sheriff then 1.0 else 0.0 end),
      'a_backfillable', count(*), now()
    from public.transfer t join public.parcel p on p.parcel_pk = t.parcel_pk
    where p.${col} is not null and t.recording_date is not null ${floor('t.recording_date', m)}
    group by p.${col}, to_char(t.recording_date,'YYYY-MM') ${ON_CONFLICT}`,
  // momentum lens — permit count.
  ({ geoType, col }, m) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(pm.permit_issued_date,'YYYY-MM'), 'permit_count',
      count(*), 'a_backfillable', count(*), now()
    from public.permit pm join public.parcel p on p.parcel_pk = pm.parcel_pk
    where p.${col} is not null and pm.permit_issued_date is not null ${floor('pm.permit_issued_date', m)}
    group by p.${col}, to_char(pm.permit_issued_date,'YYYY-MM') ${ON_CONFLICT}`,
  // crime count (livability input + trend). crime_incident carries its own geo ids.
  ({ geoType, col }, m) => `insert into public.geo_metric ${COLS}
    select '${geoType}', ci.${col}, to_char(ci.occurred_on,'YYYY-MM'), 'crime_count',
      count(*), 'a_backfillable', count(*), now()
    from public.crime_incident ci
    where ci.${col} is not null and ci.occurred_on is not null ${floor('ci.occurred_on', m)}
    group by ci.${col}, to_char(ci.occurred_on,'YYYY-MM') ${ON_CONFLICT}`,
  // 311 request count (livability input + trend).
  ({ geoType, col }, m) => `insert into public.geo_metric ${COLS}
    select '${geoType}', sr.${col}, to_char(sr.occurred_on,'YYYY-MM'), 'request_count',
      count(*), 'a_backfillable', count(*), now()
    from public.service_request sr
    where sr.${col} is not null and sr.occurred_on is not null ${floor('sr.occurred_on', m)}
    group by sr.${col}, to_char(sr.occurred_on,'YYYY-MM') ${ON_CONFLICT}`,
];

/**
 * Class-(b) forward-accruing CURRENT-snapshot metrics. One row per geo for the current
 * month, recomputed (overwritten) each run.
 */
const CLASS_B: ((g: GeoCol) => string)[] = [
  // distress lens — mean parcel composite over the geo.
  ({ geoType, col }) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(current_date,'YYYY-MM'), 'distress_share',
      avg(ds.score01), 'b_forward_accruing', count(*), now()
    from public.parcel p join public.distress_signal ds on ds.parcel_pk = p.parcel_pk
    where p.${col} is not null and p.is_active
    group by p.${col} ${ON_CONFLICT}`,
  // delinquency share — parcels with any tax delinquency.
  ({ geoType, col }) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(current_date,'YYYY-MM'), 'delinquency_share',
      avg(case when d.parcel_pk is not null then 1.0 else 0.0 end),
      'b_forward_accruing', count(*), now()
    from public.parcel p
    left join (select distinct parcel_pk from public.tax_delinquency where parcel_pk is not null) d
      on d.parcel_pk = p.parcel_pk
    where p.${col} is not null and p.is_active
    group by p.${col} ${ON_CONFLICT}`,
  // open-violation share — parcels with an open violation.
  ({ geoType, col }) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(current_date,'YYYY-MM'), 'open_violation_share',
      avg(case when v.parcel_pk is not null then 1.0 else 0.0 end),
      'b_forward_accruing', count(*), now()
    from public.parcel p
    left join (
      select distinct parcel_pk from public.violation
      where parcel_pk is not null and upper(coalesce(status,'')) not in ('CLOSED','COMPLIED','RESOLVED')
    ) v on v.parcel_pk = p.parcel_pk
    where p.${col} is not null and p.is_active
    group by p.${col} ${ON_CONFLICT}`,
  // assessment level — median market value.
  ({ geoType, col }) => `insert into public.geo_metric ${COLS}
    select '${geoType}', p.${col}, to_char(current_date,'YYYY-MM'), 'assessment_median',
      percentile_cont(0.5) within group (order by p.market_value),
      'b_forward_accruing', count(*), now()
    from public.parcel p
    where p.${col} is not null and p.is_active and p.market_value is not null
    group by p.${col} ${ON_CONFLICT}`,
  // livability lens — min-max-normalized, inverted crime+311 load across the geo type
  // (1 = best). Built from all loaded incident history (documented; refines as the
  // crime/311 backfills complete). The geo set is EVERY geo_boundary unit of this type
  // (LEFT JOIN), so a pristine geo with zero crime AND zero 311 still gets a row
  // (bad=0 → most livable) — the class-(b) "one row per geo" contract holds even for
  // incident-free geos. sample_size = the incident count that fed the index (this
  // metric's natural sample, distinct from the other class-(b) metrics' parcel counts).
  ({ geoType, col }) => `insert into public.geo_metric ${COLS}
    with all_geos as (
      select geo_id from public.geo_boundary where geo_type = '${geoType}'
    ),
    crime as (
      select ${col} as geo_id, count(*) as c from public.crime_incident
      where ${col} is not null group by ${col}
    ),
    req as (
      select ${col} as geo_id, count(*) as r from public.service_request
      where ${col} is not null group by ${col}
    ),
    comb as (
      select g.geo_id, coalesce(c.c,0) + coalesce(r.r,0) as bad
      from all_geos g
      left join crime c on c.geo_id = g.geo_id
      left join req r on r.geo_id = g.geo_id
    ),
    mm as (select min(bad) as lo, max(bad) as hi from comb)
    select '${geoType}', comb.geo_id, to_char(current_date,'YYYY-MM'), 'livability_index',
      case when mm.hi > mm.lo then 1.0 - (comb.bad - mm.lo) / (mm.hi - mm.lo)::numeric else 1.0 end,
      'b_forward_accruing', comb.bad, now()
    from comb cross join mm ${ON_CONFLICT}`,
];

export interface RecomputeGeoMetricsOptions {
  /**
   * Full historical backfill of the class-(a) monthly series when true (no date floor);
   * the nightly leaves it false and recomputes only the trailing window.
   */
  backfill?: boolean;
  /** Trailing months recomputed for class-(a) on a nightly (default 3). */
  trailingMonths?: number;
  log?: (msg: string) => void;
}

export interface RecomputeGeoMetricsResult {
  classAStatements: number;
  classBStatements: number;
}

/**
 * Recompute geo_metric for all geo types. Class (a) over the trailing window (or full
 * on backfill); class (b) as a current-month snapshot. Idempotent (upsert on the grain).
 */
export async function recomputeGeoMetrics(
  db: DbClient,
  opts: RecomputeGeoMetricsOptions = {},
): Promise<RecomputeGeoMetricsResult> {
  const log = opts.log ?? (() => {});
  const months = opts.backfill ? null : opts.trailingMonths ?? 3;

  let a = 0;
  for (const g of GEO_COLS) {
    for (const build of CLASS_A) {
      await db.unsafe(build(g, months));
      a += 1;
    }
  }
  log(`geo_metric class-a: ran ${a} statements (${opts.backfill ? 'full backfill' : `trailing ${months}mo`})`);

  let b = 0;
  for (const g of GEO_COLS) {
    for (const build of CLASS_B) {
      await db.unsafe(build(g));
      b += 1;
    }
  }
  log(`geo_metric class-b: ran ${b} statements (current snapshot)`);

  return { classAStatements: a, classBStatements: b };
}
