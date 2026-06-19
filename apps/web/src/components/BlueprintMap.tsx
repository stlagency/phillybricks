'use client';

/**
 * BlueprintMap — the permanent blueprint-skin SVG choropleth (DESIGN.md §Map).
 * Draft-navy ground, blue survey hairlines, 12 neighborhood polygons shaded on
 * the active lens's sequential ramp (matched lightness, flat ~74% so the survey
 * lines read through), the active parcel as a SINGLE red 3px outline + red
 * corner-registration ticks (regardless of lens), an instrument readout
 * (cursor coords + scale bar) top-right, and the corner ticks. Hover paints a
 * 1px federal-blue stroke so red stays active-only.
 *
 * Ramp selection is theme-aware: we read data-theme off <html> and re-resolve
 * on toggle (a MutationObserver), staying in sync with ThemeToggle. Reduced
 * motion: fills swap instantly (handled by the global media query).
 *
 * The geometry here is the mockup's stylized blueprint layout. In production
 * the parcels/boundaries are PMTiles on Supabase Storage rendered by MapLibre (PRD §6); this
 * SVG is the faithful design reference for the choropleth + instrument chrome.
 */
import { useEffect, useState } from 'react';
import type { LensMetric } from '@bandbox/core/contracts';
import { HOODS, LENS_RAMPS, type HoodShape } from '../lib/mock/scan';

function useTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const read = () =>
      setTheme(
        document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
      );
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/** Compute corner-tick paths for the active polygon's first 4 vertices. */
function cornerTicks(points: string): string[] {
  const pts = points
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number) as [number, number]);
  // Use the bounding extremes (TL, TR, BR, BL-ish) — here we follow the mockup
  // which ticks the polygon's own vertices. Take up to 4.
  const [a, b, c, d] = pts;
  const ticks: string[] = [];
  if (a) ticks.push(`M${a[0]},${a[1]} l14,0 M${a[0]},${a[1]} l0,14`);
  if (b) ticks.push(`M${b[0]},${b[1]} l-14,0 M${b[0]},${b[1]} l0,14`);
  if (c) ticks.push(`M${c[0]},${c[1]} l-14,0 M${c[0]},${c[1]} l0,-14`);
  if (d) ticks.push(`M${d[0]},${d[1]} l14,0 M${d[0]},${d[1]} l0,-14`);
  return ticks;
}

const GRID_H = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480, 520];
const GRID_V = Array.from({ length: 17 }, (_, i) => (i + 1) * 40);

export interface BlueprintMapProps {
  lens: LensMetric;
  hoods?: HoodShape[];
}

export function BlueprintMap({ lens, hoods = HOODS }: BlueprintMapProps) {
  const theme = useTheme();
  const ramp = LENS_RAMPS[lens][theme];
  const [hoverId, setHoverId] = useState<string | null>(null);
  const activeHood = hoods.find((h) => h.active);

  return (
    <div className="pb-mapframe">
      <svg viewBox="0 0 760 560" role="img" aria-labelledby="maptitle mapdesc" id="mapSvg">
        <title id="maptitle">Blueprint survey map of Philadelphia neighborhoods</title>
        <desc id="mapdesc">
          A draft-navy survey map with blue grid lines and twelve labeled
          neighborhood polygons shaded on the active {lens} ramp; Point Breeze is
          the active parcel, outlined in red with corner registration ticks.
        </desc>

        <rect x="0" y="0" width="760" height="560" fill="var(--pb-draft-bg)" />

        {/* survey grid */}
        <g stroke="var(--pb-draft-line)" strokeWidth="0.5" opacity="0.32">
          {GRID_H.map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="760" y2={y} />
          ))}
          {GRID_V.map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="560" />
          ))}
        </g>

        {/* rivers */}
        <g stroke="var(--pb-draft-line)" strokeWidth="1" opacity="0.55" fill="none">
          <path d="M120,0 C150,120 110,240 175,360 C210,440 180,520 220,560" strokeDasharray="3 5" />
          <path d="M700,30 C660,150 690,280 640,400 C610,470 650,520 620,560" strokeDasharray="3 5" />
        </g>
        <text
          x="132"
          y="300"
          fill="var(--pb-draft-line)"
          fontFamily="var(--pb-font-mono)"
          fontSize="9"
          opacity="0.6"
          transform="rotate(74 132 300)"
          letterSpacing="2"
        >
          SCHUYLKILL R.
        </text>
        <text
          x="676"
          y="250"
          fill="var(--pb-draft-line)"
          fontFamily="var(--pb-font-mono)"
          fontSize="9"
          opacity="0.6"
          transform="rotate(78 676 250)"
          letterSpacing="2"
        >
          DELAWARE R.
        </text>

        {/* neighborhood polygons (choropleth) */}
        <g strokeWidth="1" fillOpacity="0.74">
          {hoods.map((h) => {
            const fill = ramp[Math.max(0, Math.min(4, h.buckets[lens]))];
            const isHover = hoverId === h.geo_id && !h.active;
            return (
              <polygon
                key={h.geo_id}
                className="pb-nh-poly"
                points={h.points}
                fill={fill}
                stroke={isHover ? 'var(--pb-blue)' : 'var(--pb-draft-line)'}
                strokeWidth={isHover ? 2 : 1}
                onMouseEnter={() => setHoverId(h.geo_id)}
                onMouseLeave={() => setHoverId(null)}
              >
                <title>{h.name}</title>
              </polygon>
            );
          })}
        </g>

        {/* active parcel: single red outline + corner registration ticks */}
        {activeHood ? (
          <>
            <g fill="none" stroke="var(--pb-lens-distress)" strokeWidth="3">
              <polygon points={activeHood.points} />
            </g>
            <g stroke="var(--pb-lens-distress)" strokeWidth="3">
              {cornerTicks(activeHood.points).map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          </>
        ) : null}

        {/* labels */}
        <g
          fontFamily="var(--pb-font-mono)"
          fontSize="9"
          fill="var(--pb-draft-line)"
          letterSpacing="0.5"
          textAnchor="middle"
        >
          {hoods
            .filter((h) => !h.active)
            .map((h) => (
              <text key={h.geo_id} x={h.labelXY[0]} y={h.labelXY[1]}>
                {h.mapLabel}
              </text>
            ))}
        </g>
        {activeHood ? (
          <text
            x={activeHood.labelXY[0]}
            y={activeHood.labelXY[1]}
            fontFamily="var(--pb-font-mono)"
            fontSize="11"
            fontWeight="700"
            fill="#FFFFFF"
            textAnchor="middle"
            letterSpacing="0.5"
          >
            {activeHood.mapLabel}
          </text>
        ) : null}

        {/* instrument readout: coords + scale bar */}
        <g>
          <rect
            x="558"
            y="0"
            width="202"
            height="58"
            fill="rgba(12,16,22,0.78)"
            stroke="var(--pb-draft-line)"
            strokeWidth="2"
          />
          <text x="746" y="18" textAnchor="end" fontFamily="var(--pb-font-mono)" fontSize="10" fill="var(--pb-draft-line)">
            39.9342°N  75.1830°W
          </text>
          <text x="746" y="32" textAnchor="end" fontFamily="var(--pb-font-mono)" fontSize="10" fill="var(--pb-draft-line)">
            SCALE 1:14,000
          </text>
          <line x1="676" y1="44" x2="746" y2="44" stroke="var(--pb-draft-line)" strokeWidth="3" />
          <line x1="676" y1="40" x2="676" y2="48" stroke="var(--pb-draft-line)" strokeWidth="2" />
          <line x1="711" y1="40" x2="711" y2="48" stroke="var(--pb-draft-line)" strokeWidth="2" />
          <line x1="746" y1="40" x2="746" y2="48" stroke="var(--pb-draft-line)" strokeWidth="2" />
          <text x="668" y="48" textAnchor="end" fontFamily="var(--pb-font-mono)" fontSize="9" fill="var(--pb-draft-line)">
            ¼ MI
          </text>
        </g>
      </svg>
    </div>
  );
}
