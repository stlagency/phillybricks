'use client';

/**
 * MarketScan — the Market Scan surface (ported from design/mockups/01-market-scan.html),
 * now wired to the live read APIs. Client component because the lens + selected
 * geo + active period are shared state across the lens switcher, the MapLibre
 * choropleth, the time strip, and the right-rail detail.
 *
 * Data flow:
 *  - `/api/scan` (active lens) → period bounds + `periods` for the TimeStrip,
 *    and (distress lens) the default-selected geo (most-distressed of the type).
 *  - `/api/geo/:type/:id` (selected geo) → GeoDetail → `geoDetailToView` →
 *    the right rail. The rail JSX is unchanged from the mock; only its source is.
 *
 * Red budget: the active-parcel red on the map is structural; the Distress lens
 * ramp IS red (the encoding); the rail's distress score block + the "Save this
 * neighborhood →" CTA are the two sanctioned rail reds.
 */
import { useEffect, useState } from 'react';
import type { LensMetric, ScanFeature, GeoType, ScanResponse, GeoDetail } from '@bandbox/core/contracts';
import { TopBand } from '../components/TopBand';
import { FilterRail } from '../components/FilterRail';
import { LensSwitcher } from '../components/LensSwitcher';
import { ScanMap } from '../components/ScanMap';
import { MapLegend } from '../components/MapLegend';
import { TimeStrip, formatPeriod } from '../components/TimeStrip';
import { DistressBlock } from '../components/DistressBlock';
import { MetricStrip, MetricCell } from '../components/MetricStrip';
import { TrendChart } from '../components/TrendChart';
import { CommunitySignal } from '../components/CommunitySignal';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { geoDetailToView } from '../lib/neighborhood-view';

interface TimeMeta {
  periods: string[];
  periodMin: string;
  metricClass: ScanResponse['metric_class'];
}

const GEO_CRUMBS: { id: GeoType; label: string }[] = [
  { id: 'neighborhood', label: 'Neighborhood' },
  { id: 'tract', label: 'Tract' },
];

export function MarketScan() {
  const [lens, setLens] = useState<LensMetric>('distress');
  const [geoType, setGeoType] = useState<GeoType>('neighborhood');
  const [selected, setSelected] = useState<ScanFeature | null>(null);
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [timeMeta, setTimeMeta] = useState<TimeMeta | null>(null);
  const [detail, setDetail] = useState<ReturnType<typeof geoDetailToView> | null>(null);
  const [railLoading, setRailLoading] = useState(false);

  // (A) Active-lens period bounds for the TimeStrip; reset the period to latest
  // whenever the lens or geo type changes (bounds are per-lens).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = (await (await fetch(`/api/scan?geo=${geoType}&lens=${lens}`)).json()) as ScanResponse;
        if (cancelled) return;
        setTimeMeta({ periods: r.periods, periodMin: r.period_min, metricClass: r.metric_class });
        setPeriod(r.period_max || undefined);
      } catch {
        if (!cancelled) setTimeMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lens, geoType]);

  // (B) Default selection = the most-distressed geo of the active type. Runs on
  // mount and on geo-type change (a user click within a type is preserved).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = (await (await fetch(`/api/scan?geo=${geoType}&lens=distress`)).json()) as ScanResponse;
        if (cancelled || !r.features?.length) return;
        const top = r.features.reduce((a, b) => ((b.value ?? -Infinity) > (a.value ?? -Infinity) ? b : a));
        setSelected(top);
      } catch {
        /* leave selection as-is */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geoType]);

  // (C) Selected geo → detail rail. Dim (not blank) the rail while the new geo's
  // detail loads so it never shows a different geo than the under-map readout.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setRailLoading(true);
    (async () => {
      try {
        const d = (await (
          await fetch(`/api/geo/${selected.geo_type}/${encodeURIComponent(selected.geo_id)}`)
        ).json()) as GeoDetail;
        if (cancelled) return;
        if (d && !(d as unknown as { error?: string }).error) setDetail(geoDetailToView(d));
      } catch {
        /* keep the prior detail rather than flashing empty */
      } finally {
        if (!cancelled) setRailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const trackingSince =
    timeMeta?.metricClass === 'b_forward_accruing' && timeMeta.periodMin
      ? formatPeriod(timeMeta.periodMin)
      : undefined;

  return (
    <div className="pb-app">
      <TopBand current="Market Scan" />

      <div className="pb-shell-scan">
        <FilterRail />

        <main className="pb-mapcol">
          <div className="pb-maphead">
            <div>
              <p className="pb-kicker">Know the block before you knock.</p>
              <h1>Market Scan</h1>
            </div>
            <div className="pb-crumbs">
              <span>City</span> <span>›</span>
              {GEO_CRUMBS.map((c, i) => (
                <span key={c.id} style={{ display: 'contents' }}>
                  <button
                    type="button"
                    className={geoType === c.id ? 'pb-crumb-active' : undefined}
                    aria-pressed={geoType === c.id}
                    onClick={() => setGeoType(c.id)}
                  >
                    {c.label}
                  </button>
                  {i < GEO_CRUMBS.length - 1 ? <span>›</span> : null}
                </span>
              ))}
              <span>›</span>
              <span className="pb-crumb-disabled" title="Parcel view ships with the parcel tile layer">
                Parcel
              </span>
            </div>
          </div>

          <div className="pb-lensbar">
            <LensSwitcher active={lens} onChange={setLens} />
          </div>

          <div className="pb-map-outer">
            <ScanMap lens={lens} geoType={geoType} period={period} onSelect={setSelected} />
            {selected ? (
              <p className="pb-freshline" style={{ margin: 'var(--pb-space-3) 0 0' }}>
                {selected.name} · {lens}{' '}
                {selected.value === null
                  ? '—'
                  : Number(selected.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </p>
            ) : null}
          </div>

          <div className="pb-timestrip-wrap">
            {timeMeta && period && timeMeta.periods.length > 0 ? (
              <TimeStrip
                periods={timeMeta.periods}
                value={period}
                onChange={setPeriod}
                trackingSince={trackingSince}
              />
            ) : null}
          </div>

          <MapLegend lens={lens} />
        </main>

        {/* Right rail: neighborhood detail, wired to /api/geo/:type/:id via
            geoDetailToView. DistressBlock's useRail() safely no-ops here. */}
        <aside
          className="pb-rightrail"
          aria-label="Neighborhood detail"
          aria-busy={railLoading}
          style={railLoading && detail ? { opacity: 0.55, transition: 'opacity 0.15s ease' } : undefined}
        >
          {detail ? (
            <>
              <div className="pb-nh-head">
                <span className="pb-nh-eyebrow">{detail.eyebrow}</span>
                <h2 className="pb-nh-name">{detail.name}</h2>
                <span className="pb-nh-opa">{detail.recordLine}</span>
              </div>

              <div className="pb-pillrow">
                {detail.pills.map((p) => (
                  <Pill key={p.label} kind={p.kind}>
                    {p.label}
                  </Pill>
                ))}
              </div>

              <DistressBlock result={detail.distress} rank={detail.rank} />

              <MetricStrip layout="flex" ariaLabel="Neighborhood metrics">
                {detail.metrics.map((m) => (
                  <MetricCell
                    key={m.label}
                    label={m.label}
                    value={m.value}
                    valueTitle={m.title}
                    emphasis={m.emphasis === 'featured' ? 'featured' : 'none'}
                    sub={<span className="pb-msrc">{m.source_stamp}</span>}
                  />
                ))}
              </MetricStrip>

              <TrendChart
                title={detail.trend.title}
                bars={detail.trend.bars}
                note={detail.trend.note}
                ariaLabel={detail.trend.ariaLabel}
              />

              <div className="pb-measureline">
                <span className="pb-lead">{detail.measures.lead}</span>
                The{' '}
                <span className="pb-dotted" title={detail.measures.dottedTitle}>
                  {detail.measures.dottedTerm}
                </span>{' '}
                {detail.measures.body} <span className="pb-stamp">{detail.measures.stamp}</span>
              </div>

              <CommunitySignal variant="rail">{detail.communitySignal}</CommunitySignal>

              <div className="pb-cta-row">
                <Button variant="primary">Save this neighborhood →</Button>
                <Button variant="ghost" noShadow>
                  Open {detail.parcelCount.toLocaleString('en-US')} parcels
                </Button>
              </div>

              <p className="pb-freshline">{detail.freshline}</p>
            </>
          ) : (
            <div className="pb-nh-head">
              <span className="pb-nh-eyebrow">Loading</span>
              <h2 className="pb-nh-name">Reading the file…</h2>
              <span className="pb-nh-opa">Select a {geoType} on the map.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
