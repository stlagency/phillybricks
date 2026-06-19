'use client';

/**
 * ValueDerivationDrawer — the recessed "show the math" well below the comps
 * (DESIGN.md §Value-derivation drawer; PRD §5.2). Collapsed = a dotted-
 * underlined estimate + "SHOW THE MATH +". Expanded = plain-English Zodiak
 * derivation, each operand dotted to its source (no black box). Driven by the
 * frozen `CompsResult.estimate` + distribution.
 *
 * The insufficient-comps state renders the explicit empty state instead of a
 * low-confidence number (PRD §5.2): the South-Philly voice, not a guess.
 */
import { useState } from 'react';
import type { CompsResult } from '@bandbox/core/contracts';
import { useRail } from './ContextRail';

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n.toLocaleString('en-US')}`;
}

export interface ValueDerivationDrawerProps {
  comps: CompsResult;
  /** Subject livable area (for the derivation operand). */
  livableArea: number | null;
}

export function ValueDerivationDrawer({ comps, livableArea }: ValueDerivationDrawerProps) {
  const [open, setOpen] = useState(false);
  const rail = useRail();
  const est = comps.estimate;

  if (comps.insufficient || est.estimate === null) {
    return (
      <div className="pb-deriv">
        <div className="pb-deriv-trigger" style={{ cursor: 'default' }}>
          <span>
            <span className="pb-mlabel" style={{ marginBottom: 6 }}>
              Bandbox value estimate
            </span>
            <span className="pb-deriv-est" style={{ borderBottom: 0 }}>
              Insufficient comps
            </span>
          </span>
        </div>
        <div className="pb-deriv-body pb-open">
          <p className="pb-deriv-inner" style={{ margin: 0 }}>
            No arms-length comps within a quarter mile clear the bar. Widen the
            radius or check the next block over — we won&apos;t hand you a number
            we can&apos;t stand behind.
          </p>
        </div>
      </div>
    );
  }

  const sf = livableArea ?? comps.comps.find((c) => c.livable_area)?.livable_area ?? null;
  const psf = est.median_price_per_sqft;

  return (
    <div className="pb-deriv">
      <button
        type="button"
        className="pb-deriv-trigger"
        aria-expanded={open}
        aria-controls="deriv-body"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          <span className="pb-mlabel" style={{ marginBottom: 6 }}>
            Bandbox value estimate
          </span>
          <span className="pb-deriv-est">{fmtUsd(est.estimate)}</span>
        </span>
        <span className="pb-deriv-toggle">{open ? 'HIDE THE MATH −' : 'SHOW THE MATH +'}</span>
      </button>

      <div
        className={`pb-deriv-body${open ? ' pb-open' : ''}`}
        id="deriv-body"
        role="region"
        aria-label="Value estimate derivation"
      >
        <div className="pb-deriv-inner">
          <Op onClick={() => rail.openSource('RTT · arms-length comp set')}>
            {comps.distribution.n_trimmed} arms-length comps within{' '}
            {Math.max(...comps.comps.map((c) => c.reason.distance_mi)).toFixed(1)} mi
          </Op>
          , p5/p95 trimmed · median{' '}
          {psf != null ? (
            <Op onClick={() => rail.openSource('RTT · median $/SF')}>${psf} / SF</Op>
          ) : null}
          {sf != null ? (
            <>
              {' '}
              ×{' '}
              <Op onClick={() => rail.openSource('OPA · livable area')}>
                {sf.toLocaleString('en-US')} SF
              </Op>
            </>
          ) : null}
          {est.adjustments.map((adj) => (
            <span key={adj.label}>
              {' '}
              {adj.factor < 0 ? '−' : '+'}{' '}
              <Op onClick={() => rail.openSource(`L&I · ${adj.label} ${adj.source_stamp}`)}>
                {Math.round(Math.abs(adj.factor) * 100)}% {adj.label.toLowerCase()}
              </Op>
            </span>
          ))}{' '}
          = <strong>{fmtUsd(est.estimate)}</strong>. Numbers don&apos;t lie, people do —
          every operand above links back to its record.
        </div>
      </div>
    </div>
  );
}

function Op({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="pb-op"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </button>
  );
}
