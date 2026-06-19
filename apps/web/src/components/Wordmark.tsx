'use client';

/**
 * Wordmark — BAND stacked over BOX in Tanker (DESIGN.md §Wordmark).
 * BAND (line 1) is letter-spaced so its rendered width EXACTLY equals BOX, so
 * the two stacked words share one right edge (a solid monolithic block). We
 * measure after document.fonts.ready (and on resize) and set line-1's
 * letter-spacing = (BOX_width − BAND_width) / n, where n = line-1 letter count,
 * iterating a few times to converge — the same equalizer the mockups run.
 *
 * Two visual variants:
 *  - "band"  : on the Navy top band (BAND in on-navy, BOX in red/brick).
 *  - "boxed" : a bone box with ink border + offset shadow (deep-dive header).
 */
import { useCallback, useEffect, useRef } from 'react';

export type WordmarkVariant = 'band' | 'boxed';

export interface WordmarkProps {
  variant?: WordmarkVariant;
  /** Font-size for the two lines (px). Band nav ≈ 24, boxed ≈ 30. */
  size?: number;
  className?: string;
}

export function Wordmark({ variant = 'band', size, className }: WordmarkProps) {
  const philRef = useRef<HTMLSpanElement>(null);
  const brickRef = useRef<HTMLSpanElement>(null);

  const fit = useCallback(() => {
    const a = philRef.current;
    const b = brickRef.current;
    if (!a || !b) return;
    a.style.letterSpacing = 'normal';
    const target = b.getBoundingClientRect().width;
    if (target <= 0) return;
    const n = (a.textContent || '').replace(/\s/g, '').length || 1;
    for (let i = 0; i < 3; i++) {
      const w = a.getBoundingClientRect().width;
      const cur = parseFloat(a.style.letterSpacing) || 0;
      a.style.letterSpacing = `${cur + (target - w) / n}px`;
    }
  }, []);

  useEffect(() => {
    // Run after fonts load (Tanker metrics differ from the fallback), on load,
    // and on resize. fonts.ready resolves once; the load/resize listeners catch
    // late layout. Guarded for SSR.
    if (typeof document === 'undefined') return;
    if (document.fonts && document.fonts.ready) {
      void document.fonts.ready.then(fit);
    }
    fit();
    window.addEventListener('load', fit);
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('load', fit);
      window.removeEventListener('resize', fit);
    };
  }, [fit]);

  const boxed = variant === 'boxed';
  // Band nav lines render at 24px in the mockup; the boxed variant inherits its
  // own 30px (--pb-text-2xl) from CSS unless an explicit size is passed.
  const resolvedSize = size ?? (boxed ? undefined : 24);
  const style = resolvedSize ? { fontSize: `${resolvedSize}px` } : undefined;

  return (
    <span
      className={`${boxed ? 'pb-mark-boxed' : 'pb-wordmark'}${className ? ` ${className}` : ''}`}
      style={style}
      aria-label="Bandbox"
    >
      <span className="pb-l1" ref={philRef} aria-hidden="true">
        BAND
      </span>
      <span className="pb-l2" ref={brickRef} aria-hidden="true">
        BOX
      </span>
    </span>
  );
}
