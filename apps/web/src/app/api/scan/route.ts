/**
 * GET /api/scan?geo=&lens=&period= — choropleth values for one lens (PRD §6, §7.1).
 * Reads public.geo_metric (the active lens's metric) joined to public.geo_boundary
 * for names, assigns quantile buckets, and returns the frozen ScanResponse. Also
 * returns the metric's available period_min/period_max so the time control knows
 * its range; class-(b) lenses carry metric_class='b_forward_accruing' for the
 * "tracking since …" UI label.
 */
import { NextResponse } from 'next/server';
import type { ScanResponse, ScanFeature } from '@bandbox/core/contracts';
import { db } from '../../../lib/db';
import { LENS_METRIC, isLens, isGeoType, quantileBuckets, median } from '../../../lib/scan-meta';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const lens = url.searchParams.get('lens') ?? 'distress';
  const geo = url.searchParams.get('geo') ?? 'neighborhood';
  const periodParam = url.searchParams.get('period');
  if (!isLens(lens)) return NextResponse.json({ error: 'invalid lens' }, { status: 400 });
  if (!isGeoType(geo)) return NextResponse.json({ error: 'invalid geo' }, { status: 400 });

  const { metric, unit, metricClass } = LENS_METRIC[lens];
  const sql = db();

  const periodRows = await sql<{ period: string }[]>`
    select distinct period from public.geo_metric
    where geo_type = ${geo} and metric = ${metric} order by period`;
  const periods = periodRows.map((r) => r.period);
  const period_min = periods[0] ?? '';
  const period_max = periods[periods.length - 1] ?? '';
  // Fall back to the latest period if the requested one doesn't exist for this
  // metric (lenses have different period grains; a stale ?period= must not paint
  // an empty/all-gray map — return the latest real data instead).
  const period = periodParam && periods.includes(periodParam) ? periodParam : period_max;

  let features: ScanFeature[] = [];
  let present: number[] = [];
  let resolvedClass: ScanResponse['metric_class'] = metricClass;

  if (period) {
    const rows = await sql<{ geo_id: string; name: string | null; value: string | null; metric_class: string }[]>`
      select gm.geo_id, gb.name, gm.value::text as value, gm.metric_class
      from public.geo_metric gm
      join public.geo_boundary gb
        on gb.geo_type = gm.geo_type and gb.geo_id = gm.geo_id
      where gm.geo_type = ${geo} and gm.metric = ${metric} and gm.period = ${period}
      order by gm.geo_id`;
    const values = rows.map((r) => (r.value === null ? null : Number(r.value)));
    const buckets = quantileBuckets(values);
    features = rows.map((r, i) => ({
      geo_id: r.geo_id,
      geo_type: geo,
      name: r.name ?? r.geo_id,
      value: values[i] ?? null,
      bucket: buckets[i] ?? 0,
    }));
    present = values.filter((v): v is number => v !== null);
    if (rows[0]?.metric_class) resolvedClass = rows[0].metric_class as ScanResponse['metric_class'];
  }

  const body: ScanResponse = {
    geo_type: geo,
    lens,
    period,
    features,
    period_min,
    period_max,
    periods,
    metric_class: resolvedClass,
    legend: {
      min: present.length ? Math.min(...present) : null,
      median: median(present),
      max: present.length ? Math.max(...present) : null,
      unit,
    },
  };
  return NextResponse.json(body);
}
