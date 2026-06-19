'use client';

/**
 * ContextRail — the teach-in-place context rail (DESIGN.md §Components,
 * §Transparency). A right-side 4px-bordered --pb-rail column that holds
 * glossary definitions and "where this comes from" source records. NEVER a
 * floating modal — dotted terms and source stamps push a block into THIS rail.
 *
 * RailProvider owns the rail's entries + api and must wrap BOTH the page main
 * column and the <ContextRail>, so any descendant (SourceStamp, GlossaryTerm,
 * DistressBar segment, derivation operand) can call useRail().teach() /
 * .openSource() to surface a block here. Mirrors the mockup teach()/openSource()
 * behavior: a fresh block is inserted just under the intro and flashes briefly.
 *
 * Production wiring: glossary defs come from the education layer (PRD §7.6);
 * source records resolve to the originating public record (Atlas) via the
 * `source_url` already carried on every Sourced<T> / *Component (PRD §6).
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

export interface RailDefinition {
  term: string;
  def: string;
  src: string;
  /** Optional href shown as "View record on Atlas →". */
  href?: string;
}

interface RailEntry extends RailDefinition {
  key: string;
  flash: boolean;
}

interface RailApi {
  teach: (d: RailDefinition) => void;
  openSource: (label: string, href?: string) => void;
}

interface RailState {
  entries: RailEntry[];
  api: RailApi;
}

const RailContext = createContext<RailState | null>(null);

/** Glossary definitions (ported from the deep-dive mockup `defs`). */
export const GLOSSARY: Record<string, RailDefinition> = {
  clr: {
    term: 'CLR — Common Level Ratio',
    def: 'The factor the state uses to line up an assessed value with what properties actually sell for. When the assessment looks high against the comps, the CLR is the lever you check first.',
    src: 'PA State Tax Equalization Board, 2026',
  },
  armslength: {
    term: 'Arms-length sale',
    def: 'A sale between two unrelated parties, each acting in their own interest — no family transfer, no $1 estate deed, no sheriff sale. The only kind we trust as a comp.',
    src: 'Records Dept deed index',
  },
  distress: {
    term: 'Distress score',
    def: 'A 0–100 read built from tax-delinquency, vacancy, and open violations, each normalized and weighted. Higher means more distress. Every piece is decomposable — tap a segment to see the receipt.',
    src: 'Bandbox model · OPA + L&I + REV',
  },
};

/** Human labels for the [SRC] short codes (ported from mockup `srcLabels`). */
export const SOURCE_LABELS: Record<string, string> = {
  opa: 'OPA · Office of Property Assessment',
  rtt: 'RTT · Recorded deed, Records Dept',
  li: 'L&I · Licenses & Inspections',
  rev: 'REV · Department of Revenue',
  sheriff: 'Sheriff sale record',
};

export function useRail(): RailApi {
  const ctx = useContext(RailContext);
  // No-op fallback so components remain usable outside a rail (e.g. leads list).
  return ctx?.api ?? { teach: () => {}, openSource: () => {} };
}

/**
 * RailProvider — wrap the page (main column + rail) so any descendant can
 * useRail(), and so <ContextRail/> can read the entries to render.
 */
export function RailProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<RailEntry[]>([]);
  const seq = useRef(0);

  const push = useCallback((entry: Omit<RailEntry, 'key' | 'flash'>) => {
    const key = `rail-${seq.current++}`;
    setEntries((prev) => [{ ...entry, key, flash: true }, ...prev]);
    window.setTimeout(() => {
      setEntries((prev) =>
        prev.map((e) => (e.key === key ? { ...e, flash: false } : e)),
      );
    }, 1400);
  }, []);

  const api = useRef<RailApi>({
    teach: (d) => push(d),
    openSource: (label, href) =>
      push({
        term: 'WHERE THIS COMES FROM',
        def: `${label}. This is the originating public record for the figure you tapped — open it to verify the raw entry.`,
        src: label,
        href: href ?? 'https://atlas.phila.gov',
      }),
  });
  // keep the ref's closures pointing at the latest push
  api.current.teach = (d) => push(d);
  api.current.openSource = (label, href) =>
    push({
      term: 'WHERE THIS COMES FROM',
      def: `${label}. This is the originating public record for the figure you tapped — open it to verify the raw entry.`,
      src: label,
      href: href ?? 'https://atlas.phila.gov',
    });

  return (
    <RailContext.Provider value={{ entries, api: api.current }}>
      {children}
    </RailContext.Provider>
  );
}

export interface ContextRailProps {
  /** Rail heading, e.g. "The file, explained". */
  heading?: string;
  /** Intro block content (the "START HERE" copy). */
  intro?: React.ReactNode;
  /** Static blocks rendered below the dynamic ones (e.g. SOURCE STAMPS legend). */
  staticBlocks?: { term: string; body: React.ReactNode; src?: string; rule?: boolean }[];
}

export function ContextRail({
  heading = 'The file, explained',
  intro,
  staticBlocks = [],
}: ContextRailProps) {
  const ctx = useContext(RailContext);
  const entries = ctx?.entries ?? [];

  return (
    <aside className="pb-rail" aria-label="Teach-in-place context rail">
      <h2 className="pb-rail-head">{heading}</h2>
      <div className="pb-rail-block" id="rail-intro">
        <p className="pb-rail-term">START HERE</p>
        <p className="pb-rail-def">
          {intro ?? (
            <>
              Tap any dotted term or source stamp in the file and the
              plain-English version opens right here — like a margin note from
              someone who actually lives on the block.
            </>
          )}
        </p>
      </div>

      {entries.map((e) => (
        <div key={e.key} className={`pb-rail-block${e.flash ? ' pb-flash' : ''}`}>
          <p className="pb-rail-term">{e.term}</p>
          <hr className="pb-section-rule" />
          <p className="pb-rail-def">{e.def}</p>
          <p className="pb-rail-src">
            {e.href ? (
              <a href={e.href} target="_blank" rel="noreferrer">
                View record on Atlas →
              </a>
            ) : (
              <>SOURCE · {e.src}</>
            )}
          </p>
        </div>
      ))}

      {staticBlocks.map((b) => (
        <div className="pb-rail-block" key={b.term}>
          <p className="pb-rail-term">{b.term}</p>
          {b.rule ? <hr className="pb-section-rule" /> : null}
          <p className="pb-rail-def">{b.body}</p>
          {b.src ? <p className="pb-rail-src">SOURCE · {b.src}</p> : null}
        </div>
      ))}
    </aside>
  );
}
