'use client';

/**
 * MapLegend — bottom legend card on --pb-rail (DESIGN.md §Map): a plain-language
 * Zodiak caption, the active lens's 5-stop ramp chips, and Space Mono numeric
 * break ticks (min · median · max + units). Theme-aware ramp, in sync with the
 * BlueprintMap.
 */
import { useEffect, useState } from 'react';
import type { LensMetric } from '@bandbox/core/contracts';
import { LENS_META, LENS_RAMPS } from '../lib/mock/scan';

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

export function MapLegend({ lens }: { lens: LensMetric }) {
  const theme = useTheme();
  const meta = LENS_META[lens];
  const ramp = LENS_RAMPS[lens][theme];

  return (
    <div className="pb-maplegend">
      <div className="pb-legend">
        <span className="pb-lh">{meta.head}</span>
        <p className="pb-cap">{meta.cap}</p>
        <div className="pb-ramp">
          {ramp.map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </div>
        <div className="pb-ticks">
          <span>{meta.min}</span>
          <span>{meta.mid}</span>
          <span>{meta.max}</span>
        </div>
      </div>
    </div>
  );
}
