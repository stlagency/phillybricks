'use client';

/**
 * TimeStrip — bordered time slider + "tracking since {date}" note (DESIGN.md
 * §Map; PRD §7.1). Driven by the scan response's real `periods` list (sorted
 * 'YYYY-MM' strings): the slider indexes into that array so every stop is a real
 * period, and `onChange` lifts the selected period up to drive the map. Class-(b)
 * (forward-accruing) lenses get the "tracking since …" framing.
 */
export interface TimeStripProps {
  /** Sorted ascending list of real period strings ('YYYY-MM'). */
  periods: string[];
  /** Currently-selected period (must be in `periods`). */
  value: string;
  onChange: (period: string) => void;
  /** "tracking since …" note (shown for forward-accruing lenses). */
  trackingSince?: string;
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-04' → 'Apr 2026'; passes through anything non-monthly (e.g. mock '2026 Q2'). */
export function formatPeriod(p: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (!m) return p;
  return `${MONTHS[Number(m[2])] ?? m[2]} ${m[1]}`;
}

export function TimeStrip({ periods, value, onChange, trackingSince }: TimeStripProps) {
  const idx = Math.max(0, periods.indexOf(value));
  const single = periods.length <= 1;

  return (
    <div className="pb-timestrip">
      <span className="pb-tlabel">Time</span>
      <input
        type="range"
        min={0}
        max={Math.max(0, periods.length - 1)}
        value={idx}
        step={1}
        disabled={single}
        aria-label="Time period"
        aria-valuetext={formatPeriod(value)}
        onChange={(e) => {
          const next = periods[Number(e.target.value)];
          if (next) onChange(next);
        }}
      />
      <span className="pb-tval">{formatPeriod(value)}</span>
      {trackingSince ? <span className="pb-tnote">tracking since {trackingSince}</span> : null}
    </div>
  );
}
