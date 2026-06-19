'use client';

/**
 * ScanMap — the real MapLibre choropleth (PRD §7.1). Replaces the stylized
 * blueprint SVG (kept in BlueprintMap.tsx as the design reference / backlog) with
 * a live map of Philadelphia's neighborhood boundaries, colored from the active
 * lens's geo_metric values.
 *
 * Data: /api/boundaries (GeoJSON geometry) joined to /api/scan (per-lens value +
 * quantile bucket) on geo_id. Fill is the lens's 5-stop ramp (theme-aware,
 * matching the blueprint design's LENS_RAMPS); the draft-navy ground + survey-blue
 * borders keep the instrument feel without an external tile provider (the high-zoom
 * per-parcel layer is the PMTiles object on Supabase Storage — packages/tiles — added with deploy).
 *
 * Recolors on lens + theme change; click a neighborhood → onSelect(feature).
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import type { LensMetric, ScanFeature } from '@bandbox/core/contracts';
import { LENS_RAMPS } from '../lib/mock/scan';

const DRAFT_BG = '#1C2530';
const DRAFT_LINE = '#7FB0E0';
const PHILLY_BOUNDS: [number, number, number, number] = [-75.2803, 39.8670, -74.9558, 40.1379];

/** Public PMTiles base (Supabase Storage); exposed to the client via NEXT_PUBLIC_. */
const TILES_BASE = process.env.NEXT_PUBLIC_TILES_BASE_URL;
/** Vector source-layer name inside parcels.pmtiles (must match packages/tiles PARCEL_LAYER). */
const PARCEL_SOURCE_LAYER = 'parcels';

let pmtilesRegistered = false;
/** Register the pmtiles:// protocol with MapLibre once (client-side). */
function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

/** A blank MapLibre style — no external tiles, just the draft-navy ground. */
const blankStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': DRAFT_BG } }],
};

function useTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/**
 * A draft-chrome "Reset zoom" control (USER-REQUESTED) that re-fits the map to
 * PHILLY_BOUNDS. Styled to the instrument palette (draft-navy ground, survey-blue
 * ink + border, mono caps) so it reads as part of the blueprint, not a stock
 * MapLibre widget. Placed in the top-left control stack under NavigationControl.
 */
function makeResetControl(): maplibregl.IControl {
  let container: HTMLDivElement;
  return {
    onAdd(map) {
      container = document.createElement('div');
      container.className = 'maplibregl-ctrl';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = 'Reset zoom to Philadelphia';
      btn.setAttribute('aria-label', 'Reset zoom to Philadelphia');
      btn.textContent = 'Reset';
      Object.assign(btn.style, {
        background: DRAFT_BG,
        color: DRAFT_LINE,
        border: `1px solid ${DRAFT_LINE}59`,
        borderRadius: '4px',
        padding: '4px 8px',
        font: '11px var(--pb-font-mono, monospace)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
      } as Partial<CSSStyleDeclaration>);
      btn.addEventListener('click', () => map.fitBounds(PHILLY_BOUNDS, { padding: 24 }));
      container.appendChild(btn);
      return container;
    },
    onRemove() {
      container.remove();
    },
  };
}

/** MapLibre fill-color expression: match the joined `bucket` (0..4) to the lens ramp. */
function fillColorExpr(ramp: string[]): maplibregl.ExpressionSpecification {
  return [
    'match',
    ['get', 'bucket'],
    0, ramp[0]!,
    1, ramp[1]!,
    2, ramp[2]!,
    3, ramp[3]!,
    4, ramp[4]!,
    ramp[0]!,
  ];
}

export interface ScanMapProps {
  lens: LensMetric;
  geoType?: 'neighborhood' | 'zip' | 'tract';
  /** Active period ('YYYY-MM'); omitted ⇒ the API's latest. */
  period?: string;
  onSelect?: (f: ScanFeature | null) => void;
}

export function ScanMap({ lens, geoType = 'neighborhood', period, onSelect }: ScanMapProps) {
  const theme = useTheme();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Geometry is stamped with the geoType it was loaded for, so a paint that
  // races ahead of a geo-type switch (boundaries still in flight) can bail
  // instead of joining new scan values onto the old geometry.
  const boundaryRef = useRef<{ geoType: string; fc: FeatureCollection } | null>(null);
  const [ready, setReady] = useState(false);
  // Bumped when fresh boundaries land, so the value/paint effect re-runs.
  const [dataVersion, setDataVersion] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePmtilesProtocol();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: blankStyle,
      bounds: PHILLY_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(makeResetControl(), 'top-left');
    map.on('load', () => {
      mapRef.current = map;
      map.resize(); // container may have sized after init
      setReady(true);
    });
    // Keep the GL canvas matched to the (aspect-ratio) container as it lays out.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Load boundary geometry whenever the geo type changes. Only sets the stamped
  // ref + bumps dataVersion; the value/paint effect (which has the full dep set)
  // owns every applyData call, so painting never runs from a stale closure.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fc = (await (await fetch(`/api/boundaries?geo=${geoType}`)).json()) as FeatureCollection;
        if (cancelled) return;
        boundaryRef.current = { geoType, fc };
        setDataVersion((v) => v + 1);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geoType]);

  // Fetch the lens values + (re)apply the join + paint on lens/theme/period/geo
  // change and once fresh geometry arrives (dataVersion).
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    applyData(mapRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, theme, ready, geoType, period, dataVersion]);

  /** Join /api/scan buckets into the boundary GeoJSON and (re)paint. */
  async function applyData(map: maplibregl.Map) {
    // Bail if geometry hasn't caught up to the active geoType (a switch in flight)
    // — otherwise we'd join this geoType's scan values onto the previous geometry.
    const stamped = boundaryRef.current;
    if (!stamped || stamped.geoType !== geoType) return;
    const fc = stamped.fc;
    let scanByGeo = new Map<string, ScanFeature>();
    try {
      const periodQ = period ? `&period=${encodeURIComponent(period)}` : '';
      const scan = await (await fetch(`/api/scan?geo=${geoType}&lens=${lens}${periodQ}`)).json();
      scanByGeo = new Map((scan.features as ScanFeature[]).map((f) => [f.geo_id, f]));
    } catch {
      setStatus('error');
      return;
    }
    const joined: FeatureCollection = {
      type: 'FeatureCollection',
      features: fc.features.map((feat) => {
        const id = (feat.properties as { geo_id: string }).geo_id;
        const s = scanByGeo.get(id);
        return {
          ...feat,
          properties: {
            ...feat.properties,
            bucket: s?.bucket ?? 0,
            value: s?.value ?? null,
            name: s?.name ?? (feat.properties as { name?: string }).name ?? id,
          },
        };
      }),
    };

    const ramp = LENS_RAMPS[lens][theme];
    const src = map.getSource('hoods') as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(joined);
      map.setPaintProperty('hoods-fill', 'fill-color', fillColorExpr(ramp));
    } else {
      map.addSource('hoods', { type: 'geojson', data: joined, promoteId: 'geo_id' });
      map.addLayer({
        id: 'hoods-fill',
        type: 'fill',
        source: 'hoods',
        paint: {
          'fill-color': fillColorExpr(ramp),
          // Fade the choropleth as you zoom in so the per-parcel grid reads on the
          // draft ground (zoom must be the top-level interpolate input in MapLibre).
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.74, 15, 0.12],
        },
      });
      map.addLayer({
        id: 'hoods-line',
        type: 'line',
        source: 'hoods',
        paint: { 'line-color': DRAFT_LINE, 'line-width': 0.6, 'line-opacity': 0.7 },
      });
      wireInteractions(map);
      addParcelLayer(map);
    }
    setStatus('ready');
  }

  /**
   * High-zoom per-parcel layer from parcels.pmtiles on Supabase Storage (the
   * single nightly object, PRD §6). The OPA spine geometry is a POINT per parcel
   * (centroid, not a footprint), so parcels render as survey-blue dots — one per
   * property — shown only at zoom ≥ 14 over the faded choropleth, each a click
   * target → parcel deep-dive. No-ops if NEXT_PUBLIC_TILES_BASE_URL isn't set.
   */
  function addParcelLayer(map: maplibregl.Map) {
    if (!TILES_BASE || map.getSource('parcels')) return;
    map.addSource('parcels', {
      type: 'vector',
      url: `pmtiles://${TILES_BASE}/parcels.pmtiles`,
      promoteId: 'parcel_pk',
    });
    map.addLayer({
      id: 'parcels-circle',
      type: 'circle',
      source: 'parcels',
      'source-layer': PARCEL_SOURCE_LAYER,
      minzoom: 14,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.3, 16, 3, 18, 5],
        'circle-color': DRAFT_LINE,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.7],
        'circle-stroke-color': DRAFT_BG,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, 0.6],
      },
    });
    wireParcelInteractions(map);
  }

  /** Hover highlight + click a parcel → /parcel/[pk] deep-dive. */
  function wireParcelInteractions(map: maplibregl.Map) {
    let hovered: string | number | undefined;
    const fs = (id: string | number) => ({ source: 'parcels', sourceLayer: PARCEL_SOURCE_LAYER, id });
    map.on('mousemove', 'parcels-circle', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (!f) return;
      if (hovered !== undefined) map.setFeatureState(fs(hovered), { hover: false });
      hovered = f.id as string | number;
      map.setFeatureState(fs(hovered), { hover: true });
    });
    map.on('mouseleave', 'parcels-circle', () => {
      map.getCanvas().style.cursor = '';
      if (hovered !== undefined) map.setFeatureState(fs(hovered), { hover: false });
      hovered = undefined;
    });
    map.on('click', 'parcels-circle', (e) => {
      const pk = (e.features?.[0]?.properties as { parcel_pk?: string | number } | undefined)?.parcel_pk;
      if (pk !== undefined && pk !== null) router.push(`/parcel/${pk}`);
    });
  }

  /** Hover feature-state + click → onSelect. */
  function wireInteractions(map: maplibregl.Map) {
    let hovered: string | number | undefined;
    map.on('mousemove', 'hoods-fill', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (!f) return;
      if (hovered !== undefined) map.setFeatureState({ source: 'hoods', id: hovered }, { hover: false });
      hovered = f.id as string | number;
      map.setFeatureState({ source: 'hoods', id: hovered }, { hover: true });
    });
    map.on('mouseleave', 'hoods-fill', () => {
      map.getCanvas().style.cursor = '';
      if (hovered !== undefined) map.setFeatureState({ source: 'hoods', id: hovered }, { hover: false });
      hovered = undefined;
    });
    map.on('click', 'hoods-fill', (e) => {
      const p = e.features?.[0]?.properties as { geo_id: string; name: string; value: number | null; bucket: number } | undefined;
      if (p && onSelect) onSelect({ geo_id: p.geo_id, geo_type: geoType, name: p.name, value: p.value, bucket: p.bucket });
    });
  }

  return (
    <div className="pb-mapframe" style={{ width: '100%', display: 'block', aspectRatio: '760 / 560' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-label={`Philadelphia ${geoType} map — ${lens} lens`} role="img" />
      {status === 'error' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: DRAFT_LINE, fontFamily: 'var(--pb-font-mono)', fontSize: 12 }}>
          map data unavailable
        </div>
      ) : null}
    </div>
  );
}
