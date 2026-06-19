/**
 * Aggregate one geo unit's detail for the Market Scan rail (PRD §7.1).
 *
 * The distress decomposition is built by AGGREGATING the per-parcel
 * distress_signal matview to the geo, with the per-component normalization
 * (caps) + weights read from the SAME versioned DISTRESS_CONFIG that generated
 * the matview — so there is no duplicated/hardcoded scoring constant here (the
 * drift hazard the M3 work was careful about). The aggregate SELECT list is
 * generated from the config; component names are config keys (a fixed allowlist,
 * not user input) and the geo id is always a bound param.
 *
 * `distress.score01` is the geo's MEAN parcel distress (== geo_metric
 * distress_share); Σ component contribution = score01 (mean-of-normalized). The
 * separate `distress_percentile` is the rank-based 0..100 index the rail shows
 * as its headline (consistent with the rank-bucketed choropleth).
 */
import type { Sql } from 'postgres';
import { DISTRESS_CONFIG, DISTRESS_COMPONENT_KEYS } from '@bandbox/core';
import type {
  GeoDetail,
  GeoType,
  DistressComponent,
  DistressResult,
  GeoMetricCell,
} from '@bandbox/core/contracts';

/** Trusted geo_type → parcel geo-stamp column (not user input). */
const GEO_COL: Record<GeoType, string> = {
  neighborhood: 'neighborhood_id',
  tract: 'tract_id',
  zip: 'zip_id',
};

/** Display unit per geo_metric metric (for the rail strip). */
const METRIC_UNIT: Record<string, string> = {
  median_sale_price: '$',
  median_price_per_sqft: '$/sqft',
  assessment_median: '$',
  distress_share: 'share',
  delinquency_share: 'share',
  open_violation_share: 'share',
  livability_index: 'index',
  permit_count: 'permits',
  crime_count: 'incidents',
  request_count: 'requests',
  sheriff_deed_share: 'share',
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const n0 = (v: unknown): number => num(v) ?? 0;

/**
 * Assemble GeoDetail for one geo unit. Returns null when the geo id does not
 * exist (the route turns that into a 404), matching computeComps' contract.
 */
export async function computeGeoDetail(
  sql: Sql,
  type: GeoType,
  id: string,
): Promise<GeoDetail | null> {
  const b = await sql<{ name: string | null }[]>`
    select name from public.geo_boundary where geo_type = ${type} and geo_id = ${id}`;
  if (b.length === 0) return null;
  const name = b[0]!.name ?? id;
  const geoCol = GEO_COL[type];

  // --- per-component aggregate (SELECT list generated from the versioned config) ---
  const parts: string[] = ['count(*)::text as parcel_count', 'avg(ds.score01)::text as mean_score01'];
  for (const key of DISTRESS_COMPONENT_KEYS) {
    const cfg = DISTRESS_CONFIG.components[key];
    if (cfg.normalize.kind === 'boolean') {
      parts.push(`avg((ds.${key})::int)::text as norm_${key}`);
      parts.push(`count(*) filter (where ds.${key})::text as cnt_${key}`);
    } else {
      const cap = cfg.normalize.cap;
      parts.push(
        `avg(least(greatest(coalesce(ds.${key},0),0), ${cap}) / ${cap}::float)::text as norm_${key}`,
      );
      parts.push(`count(*) filter (where coalesce(ds.${key},0) > 0)::text as cnt_${key}`);
    }
  }
  const aggQuery = `
    select ${parts.join(', ')}
    from public.parcel p
    join public.distress_signal ds on ds.parcel_pk = p.parcel_pk
    where p.is_active and p.${geoCol} = $1`;
  const aggRows = (await sql.unsafe(aggQuery, [id])) as unknown as Record<string, unknown>[];
  const agg = aggRows[0] ?? {};

  // --- metrics strip, rank/percentile, trend, freshness (independent reads) ---
  const [metricRows, rankRows, trendRows, freshRows] = await Promise.all([
    sql<{ metric: string; value: string | null; sample_size: string | null; period: string }[]>`
      select distinct on (metric) metric, value::text as value,
             sample_size::text as sample_size, period
      from public.geo_metric
      where geo_type = ${type} and geo_id = ${id}
      order by metric, period desc`,
    sql<{ rnk: string; total: string }[]>`
      with latest as (
        select max(period) as p from public.geo_metric
        where geo_type = ${type} and metric = 'distress_share'
      ), g as (
        select geo_id,
               rank() over (order by value desc) as rnk,
               count(*) over () as total
        from public.geo_metric
        where geo_type = ${type} and metric = 'distress_share'
          and period = (select p from latest)
      )
      select rnk::text as rnk, total::text as total from g where geo_id = ${id}`,
    sql<{ yr: string; value: string | null }[]>`
      select left(period,4) as yr, avg(value)::text as value
      from public.geo_metric
      where geo_type = ${type} and geo_id = ${id} and metric = 'median_sale_price'
      group by left(period,4) order by yr desc limit 6`,
    sql<{ c: string | null }[]>`
      select to_char(max(computed_at),'YYYY-MM-DD') as c
      from public.geo_metric where geo_type = ${type} and geo_id = ${id}`,
  ]);

  const computed_at = freshRows[0]?.c ?? null;
  const stamp = computed_at ? `[distress · ${computed_at}]` : '[distress]';

  const components: DistressComponent[] = DISTRESS_COMPONENT_KEYS.map((key) => {
    const cfg = DISTRESS_CONFIG.components[key];
    const normalized = n0(agg[`norm_${key}`]);
    const cnt = n0(agg[`cnt_${key}`]);
    return {
      component: key,
      label: cfg.label,
      raw_value: cnt,
      raw_display: `${cnt.toLocaleString('en-US')} ${cnt === 1 ? 'parcel' : 'parcels'}`,
      normalized,
      weight: cfg.weight,
      contribution: cfg.weight * normalized,
      source_url: '',
      source_stamp: stamp,
    };
  });
  const score01 = components.reduce((s, c) => s + c.contribution, 0);
  const distress: DistressResult = {
    parcel_pk: `${type}:${id}`,
    score01,
    score100: Math.round(score01 * 100),
    components,
    weightsVersion: DISTRESS_CONFIG.version,
  };

  const rnk = num(rankRows[0]?.rnk ?? null);
  const total = num(rankRows[0]?.total ?? null);
  const rank = rnk !== null && total !== null ? { value: rnk, of: total } : null;
  const distress_percentile =
    rnk !== null && total !== null && total > 1
      ? Math.round(((total - rnk) / (total - 1)) * 100)
      : rnk !== null
        ? 100
        : 0;

  const metrics: GeoMetricCell[] = metricRows.map((r) => ({
    metric: r.metric,
    value: num(r.value),
    unit: METRIC_UNIT[r.metric] ?? '',
    period: r.period,
    sample_size: num(r.sample_size),
  }));

  const detail: GeoDetail = {
    geo_id: id,
    geo_type: type,
    name,
    parcel_count: n0(agg.parcel_count),
    distress,
    distress_percentile,
    rank,
    metrics,
    signals: {
      tax_delinquent: n0(agg.cnt_tax_delinquent),
      vacant: n0(agg.cnt_vacancy_proxy),
      li_violations: n0(agg.cnt_open_violations),
      sheriff: n0(agg.cnt_on_sheriff_list),
    },
    trend: {
      metric: 'median_sale_price',
      unit: '$',
      points: trendRows
        .map((r) => ({ period: r.yr, value: num(r.value) }))
        .reverse(),
    },
    computed_at,
  };
  return detail;
}
