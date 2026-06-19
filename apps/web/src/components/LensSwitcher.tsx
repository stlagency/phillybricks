'use client';

/**
 * LensSwitcher — inline segmented control of the 4 map lenses (DESIGN.md
 * §Lens switcher). Active cell = ink fill + bone label + a 3px red bottom-
 * marker block (a chunk, not a thin stripe); exactly one active so color means
 * one thing. Controlled component: parent owns the active lens.
 */
import type { LensMetric } from '@bandbox/core/contracts';

const LENSES: { id: LensMetric; label: string; dotVar: string }[] = [
  { id: 'price', label: 'Price', dotVar: 'var(--pb-lens-price)' },
  { id: 'momentum', label: 'Momentum', dotVar: 'var(--pb-lens-momentum)' },
  { id: 'distress', label: 'Distress', dotVar: 'var(--pb-lens-distress)' },
  { id: 'livability', label: 'Livability', dotVar: 'var(--pb-lens-livability)' },
];

export interface LensSwitcherProps {
  active: LensMetric;
  onChange: (lens: LensMetric) => void;
}

export function LensSwitcher({ active, onChange }: LensSwitcherProps) {
  return (
    <div className="pb-lensswitch" role="group" aria-label="Map lens">
      {LENSES.map((l) => (
        <button
          key={l.id}
          type="button"
          data-lens={l.id}
          aria-pressed={active === l.id}
          onClick={() => onChange(l.id)}
        >
          <span className="pb-dot" style={{ background: l.dotVar }} />
          {l.label}
        </button>
      ))}
    </div>
  );
}
