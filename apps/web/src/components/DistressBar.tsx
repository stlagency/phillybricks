'use client';

/**
 * DistressBar — the decomposable distress bar (DESIGN.md §Decomposable distress
 * bar; PRD §5.3). Driven ENTIRELY by the frozen `DistressResult` contract:
 * each segment is sized by its `contribution`; the dominant segment is true red,
 * lesser segments step down a brick→gravel ramp. Hover/focus/click any segment
 * (or its key button) reveals the full decomposition —
 * {component, raw_value, normalized, weight, contribution, source_url} — exactly
 * the §5.3/§6 shape the API returns. The score above it is the screen's one red
 * metric block (rendered by the caller / the deep-dive page).
 *
 * The detail can render inline (deep-dive: the pb-seg-detail grid + native title
 * tooltips on hover) — that's the default. The same data also flows to the rail
 * via the source stamp on each segment's detail.
 *
 * Production: props come straight from ParcelDeepDive.distress (or a tract-
 * aggregated DistressResult for the scan rail). No transformation here.
 */
import { useState } from 'react';
import type { DistressResult, DistressComponent } from '@bandbox/core/contracts';
import { useRail } from './ContextRail';

/** Brick→gravel ramp for segments after the dominant red one. */
const SEG_CLASSES = ['pb-seg--red', 'pb-seg--brick', 'pb-seg--gravel', 'pb-seg--gravel'] as const;
const SWATCH_COLORS = ['var(--pb-red)', 'var(--pb-brick)', 'var(--pb-gravel)', 'var(--pb-gravel)'];

/** Short uppercase tag for the in-bar label, derived from the component label. */
function shortTag(c: DistressComponent): string {
  const map: Record<string, string> = {
    tax_delinquent: 'TAX',
    vacancy_proxy: 'VAC',
    open_violations: 'VIOL',
    on_sheriff_list: 'SHRF',
    actionable_sheriff_flag: 'SHRF',
    unsafe_or_imm_dang: 'UNSF',
    recent_complaints: 'CMPL',
    out_of_state_owner: 'OOS',
    below_market_last_sale: 'BMKT',
  };
  return map[c.component] ?? c.label.slice(0, 4).toUpperCase();
}

export interface DistressBarProps {
  result: DistressResult;
  /** Show the inline pb-seg-detail decomposition grid (deep-dive). */
  showDetail?: boolean;
  /** Prose intro above the bar (deep-dive). */
  intro?: React.ReactNode;
}

export function DistressBar({ result, showDetail = true, intro }: DistressBarProps) {
  const rail = useRail();
  const components = result.components;
  const [activeKey, setActiveKey] = useState<string>(components[0]?.component ?? '');
  const active = components.find((c) => c.component === activeKey) ?? components[0];

  function select(c: DistressComponent) {
    setActiveKey(c.component);
    // Also surface the receipt in the rail (no modal) — keeps screen + rail in sync.
    rail.openSource(`${c.label} · ${c.source_stamp}`, c.source_url);
  }

  // Each segment's flex weight = its contribution ×100 (the display scale).
  return (
    <div>
      {intro ? (
        <p className="pb-prose" style={{ margin: '0 0 var(--pb-space-5)' }}>
          {intro}
        </p>
      ) : null}

      <div
        className="pb-stack"
        role="img"
        aria-label={
          'Stacked distress bar: ' +
          components
            .map((c) => `${c.label} ${Math.round(c.contribution * 100)}`)
            .join(', ') +
          ` of a ${result.score100} total.`
        }
      >
        {components.map((c, i) => {
          const segClass = SEG_CLASSES[Math.min(i, SEG_CLASSES.length - 1)];
          const contrib = Math.round(c.contribution * 100);
          const tooltip =
            `${c.label} · ${c.raw_display} · normalized ${c.normalized.toFixed(2)}` +
            ` · weight ${c.weight.toFixed(2)} · contributes ${contrib} · ${c.source_stamp}`;
          return (
            <button
              key={c.component}
              type="button"
              className={`pb-seg ${segClass}`}
              style={{ flex: contrib }}
              title={tooltip}
              aria-label={`${c.label} segment, contributes ${contrib} points. Activate for the full decomposition.`}
              aria-pressed={c.component === activeKey}
              onClick={() => select(c)}
              onMouseEnter={() => setActiveKey(c.component)}
              onFocus={() => setActiveKey(c.component)}
            >
              {shortTag(c)}&nbsp;{contrib}
            </button>
          );
        })}
      </div>

      <div className="pb-seg-key">
        {components.map((c, i) => (
          <button key={c.component} type="button" onClick={() => select(c)}>
            <span
              className="pb-swatch"
              style={{ background: SWATCH_COLORS[Math.min(i, SWATCH_COLORS.length - 1)] }}
            />
            {c.label}
          </button>
        ))}
      </div>

      {showDetail && active ? (
        <div className="pb-seg-detail" aria-live="polite">
          <h4>{active.label}</h4>
          <div className="pb-deco-grid">
            <div className="pb-deco-cell">
              <p className="pb-mlabel">RAW</p>
              <span className="pb-v">{active.raw_display}</span>
            </div>
            <div className="pb-deco-cell">
              <p className="pb-mlabel">NORMALIZED</p>
              <span className="pb-v">{active.normalized.toFixed(2)}</span>
            </div>
            <div className="pb-deco-cell">
              <p className="pb-mlabel">WEIGHT</p>
              <span className="pb-v">{active.weight.toFixed(2)}</span>
            </div>
            <div className="pb-deco-cell">
              <p className="pb-mlabel">CONTRIBUTION</p>
              <span className="pb-v">{Math.round(active.contribution * 100)}</span>
            </div>
          </div>
          <p className="pb-deco-src">
            SOURCE ·{' '}
            <button
              type="button"
              className="pb-dotted"
              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit' }}
              onClick={() => rail.openSource(`${active.label} · ${active.source_stamp}`, active.source_url)}
            >
              {active.source_stamp}
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}
