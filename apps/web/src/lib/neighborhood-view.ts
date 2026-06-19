/**
 * Map the frozen API `GeoDetail` (apps/web reads it from /api/geo/:type/:id) into
 * the Market Scan rail's presentation view-model `NeighborhoodDetail`. Pure +
 * client-safe (no DB import) so it runs in the client MarketScan after the fetch.
 *
 * The rail headline shows `distress_percentile` (rank-based 0..100, consistent
 * with the rank-bucketed choropleth) as the big number, and renders the
 * decomposable bar from the real component COMPOSITION (each component's share of
 * the geo's total distress contribution, summing to 1.0) — the same convention
 * the original mock used. Provenance (raw counts, source stamps) is preserved.
 */
import type { GeoDetail, GeoType, GeoMetricCell, DistressResult } from '@bandbox/core/contracts';
import type {
  NeighborhoodDetail,
  NeighborhoodPill,
  NeighborhoodMetric,
  NeighborhoodTrend,
} from './mock/neighborhood';

const TYPE_WORD: Record<GeoType, string> = { neighborhood: 'NEIGHBORHOOD', tract: 'TRACT', zip: 'ZIP' };
const TYPE_PLURAL: Record<GeoType, string> = {
  neighborhood: 'neighborhoods',
  tract: 'tracts',
  zip: 'ZIP codes',
};
const TYPE_TITLE: Record<GeoType, string> = {
  neighborhood: 'Neighborhood',
  tract: 'Census tract',
  zip: 'ZIP code',
};

/** Largest-remainder (Hamilton) apportionment: shares (summing to ~1) → integer
 *  percents that sum to exactly `total`. Keeps the legend + bar internally
 *  consistent (no 99%/101% rounding artifacts). */
function apportion(shares: number[], total = 100): number[] {
  if (shares.length === 0) return [];
  const raw = shares.map((s) => s * total);
  const out = raw.map((r) => Math.floor(r));
  let rem = total - out.reduce((a, b) => a + b, 0);
  const byFrac = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem && k < byFrac.length; k++) out[byFrac[k]!.i]! += 1;
  return out;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function moneyShort(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v)}`;
}

function moneyExact(v: number | null): string {
  return v === null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`;
}

export function geoDetailToView(d: GeoDetail): NeighborhoodDetail {
  const by = new Map<string, GeoMetricCell>(d.metrics.map((m) => [m.metric, m]));
  const medSale = by.get('median_sale_price');
  const psf = by.get('median_price_per_sqft');

  // --- distress block: percentile headline + composition-share bar ---
  // Rescale each component to its SHARE of the geo's total distress, drop the
  // sub-0.5% noise (it would round to 0% with an invisible bar segment), then
  // apportion to integer percents summing to exactly 100. `contribution` carries
  // pct/100 so DistressBlock's round(contribution*100) renders the exact integers;
  // `weight` is set to the same share so the segment tooltip's number matches the
  // legend % (the model weight is a parcel-page concept, not a geo composition one).
  const real = d.distress;
  const denom = real.score01 > 0 ? real.score01 : 1;
  const kept = real.components
    .map((c) => ({ c, share: c.contribution / denom }))
    .filter((x) => x.share >= 0.005)
    .sort((a, b) => b.share - a.share);
  const sumKept = kept.reduce((s, x) => s + x.share, 0) || 1;
  const pcts = apportion(kept.map((x) => x.share / sumKept));
  const components = kept.map((x, i) => ({
    ...x.c,
    contribution: (pcts[i] ?? 0) / 100,
    weight: (pcts[i] ?? 0) / 100,
  }));
  const distress: DistressResult = {
    parcel_pk: real.parcel_pk,
    score01: d.distress_percentile / 100,
    score100: d.distress_percentile,
    components,
    weightsVersion: real.weightsVersion,
  };

  const rank = d.rank
    ? `${ordinal(d.rank.value)} most-distressed of ${d.rank.of} ${TYPE_PLURAL[d.geo_type]}.`
    : 'Distress rank unavailable.';

  const s = d.signals;
  const pills: NeighborhoodPill[] = [
    { label: `TAX-DELINQUENT ${s.tax_delinquent.toLocaleString('en-US')}`, kind: 'danger' },
    { label: `VACANT ${s.vacant.toLocaleString('en-US')}`, kind: 'danger' },
    { label: `L&I ${s.li_violations.toLocaleString('en-US')}`, kind: 'neutral' },
    { label: `SHERIFF ${s.sheriff.toLocaleString('en-US')}`, kind: 'aged' },
  ];

  const vacancyPct = d.parcel_count > 0 ? (s.vacant / d.parcel_count) * 100 : 0;
  const metrics: NeighborhoodMetric[] = [
    {
      label: 'Median Sale',
      value: moneyShort(medSale?.value ?? null),
      source_stamp: medSale?.period ? `[RTT · ${medSale.period}]` : '[RTT]',
      title: 'Latest monthly median sale (RTT / OPA records)',
    },
    {
      label: '$ / SF',
      value: moneyExact(psf?.value ?? null),
      source_stamp: psf?.period ? `[OPA · ${psf.period}]` : '[OPA]',
      title: 'Median price per finished sqft (OPA)',
      emphasis: 'featured',
    },
    {
      label: 'Vacancy',
      value: `${vacancyPct.toFixed(1)}%`,
      source_stamp: '[L&I proxy]',
      title: 'Vacancy-indicator share — open vacancy violation, demolition inventory, or vacancy complaint (proxy, not a register)',
    },
  ];

  // --- trend: median sale price by year ---
  const pts = d.trend.points.filter(
    (p): p is { period: string; value: number } => p.value !== null,
  );
  const max = Math.max(1, ...pts.map((p) => p.value));
  const bars = pts.map((p, i) => ({
    year: `'${p.period.slice(2)}`,
    pct: Math.round((p.value / max) * 100),
    highlight: i === pts.length - 1,
  }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  const note =
    first && last && first.value > 0
      ? (() => {
          const delta = Math.round(((last.value - first.value) / first.value) * 100);
          return `${delta >= 0 ? 'Up' : 'Down'} ${Math.abs(delta)}% since ’${first.period.slice(2)} — median sale price.`;
        })()
      : 'Median sale price by year (public record).';
  const trend: NeighborhoodTrend = {
    title: pts.length ? 'Median sale price / yr' : 'Median sale price — no history',
    bars,
    note,
    ariaLabel: `Median sale price by year: ${pts.map((p) => `${p.period} ${moneyExact(p.value)}`).join(', ') || 'no data'}.`,
  };

  return {
    geo_id: d.geo_id,
    eyebrow: `${TYPE_TITLE[d.geo_type]} · selected`,
    name: d.name,
    recordLine: `${TYPE_WORD[d.geo_type]} ${d.geo_id} · ${d.parcel_count.toLocaleString('en-US')} parcels`,
    rank,
    parcelCount: d.parcel_count,
    pills,
    distress,
    metrics,
    trend,
    measures: {
      lead: 'What this measures · source',
      body: 'aggregates every parcel’s distress signals across this area, then ranks it against its peers. Every figure traces back to its filing.',
      dottedTerm: 'distress index',
      dottedTitle: `Percentile rank of this ${TYPE_TITLE[d.geo_type].toLowerCase()} by mean parcel distress — 100 = most-distressed of ${d.rank?.of ?? '—'}.`,
      stamp: d.computed_at ? `Where this comes from · refreshed ${d.computed_at}` : 'Where this comes from',
    },
    communitySignal: `${s.vacant.toLocaleString('en-US')} parcels show vacancy indicators in ${d.name}, and ${s.tax_delinquent.toLocaleString('en-US')} carry tax debt. Public record, block by block.`,
    freshline: "Public record only. Numbers don't lie — people do. Here's the file.",
  };
}
