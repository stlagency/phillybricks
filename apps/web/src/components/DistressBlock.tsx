'use client';

/**
 * DistressBlock — the scan-rail distress hero: a red score block + a rank line,
 * the decomposable bar, and a legend of contribution rows (market-scan mockup
 * `.distressblock`). Same frozen `DistressResult` contract as DistressBar; the
 * score block is this screen's one red metric. Hovering/focusing a segment sets
 * a native tooltip with the full {component, raw, weight, source} decomposition
 * and pushes the receipt into the context rail.
 */
import type { DistressResult, DistressComponent } from '@bandbox/core/contracts';
import { useRail } from './ContextRail';

const SEG_COLORS = ['var(--pb-red)', '#C13A2E', 'var(--pb-brick)', 'var(--pb-gravel)'];

export interface DistressBlockProps {
  result: DistressResult;
  /** Rank sentence shown beside the score, e.g. "9th most-distressed …". */
  rank?: string;
}

export function DistressBlock({ result, rank }: DistressBlockProps) {
  const rail = useRail();
  const components = result.components;

  function tooltip(c: DistressComponent): string {
    return (
      `${c.label} · ${c.raw_display} · weight ${c.weight.toFixed(2)} · ${c.source_stamp}`
    );
  }

  return (
    <section className="pb-distressblock" aria-label="Distress score">
      <div className="pb-db-top">
        <div className="pb-db-score">
          <div className="pb-dlabel">Distress Score</div>
          <div className="pb-dnum">{result.score100}</div>
        </div>
        {rank ? <p className="pb-db-rank">{rank}</p> : null}
      </div>

      <div
        className="pb-dbar"
        role="img"
        aria-label={
          'Distress composition: ' +
          components
            .map((c) => `${c.label} ${Math.round(c.contribution * 100)} percent`)
            .join(', ') +
          '.'
        }
      >
        {components.map((c, i) => {
          const pct = Math.round(c.contribution * 100);
          return (
            <button
              key={c.component}
              type="button"
              className="pb-dseg"
              style={{ flex: pct, background: SEG_COLORS[Math.min(i, SEG_COLORS.length - 1)] }}
              title={tooltip(c)}
              aria-label={`${c.label}, ${pct} percent. Activate for the source record.`}
              onClick={() => rail.openSource(`${c.label} · ${c.source_stamp}`, c.source_url)}
            />
          );
        })}
      </div>

      <div className="pb-dlegend">
        {components.map((c, i) => (
          <div className="pb-dleg-row" key={c.component}>
            <span
              className="pb-sw"
              style={{ background: SEG_COLORS[Math.min(i, SEG_COLORS.length - 1)] }}
            />
            <span className="pb-nm">{c.label}</span>
            <span className="pb-ct">{Math.round(c.contribution * 100)}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
