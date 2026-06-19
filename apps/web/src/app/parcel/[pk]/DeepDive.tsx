'use client';

/**
 * DeepDive — the Property Deep-Dive surface, ported from
 * design/mockups/02-property-deep-dive.html. Rendered from a mock
 * `ParcelDeepDive` (frozen contract). Client component because the whole page
 * shares the teach-in-place context rail: source stamps + dotted terms +
 * distress segments + derivation operands all push blocks into the rail
 * (RailProvider wraps main + rail).
 *
 * Red budget on this screen (DESIGN.md §Red discipline accounting):
 *   1) the distress hero (red fill)  2) the single "SAVE THIS LEAD →" CTA.
 * Budget spent — every other action is ink/ghost, danger pills downshift only
 * where they are true signals (delinquent / unsafe), other metrics use sky-tint.
 */
import { useState } from 'react';
import type { Comp, ParcelDeepDive } from '@bandbox/core/contracts';
import { Wordmark } from '../../../components/Wordmark';
import { ThemeToggle } from '../../../components/ThemeToggle';
import { Card } from '../../../components/Card';
import { MetricStrip, MetricCell } from '../../../components/MetricStrip';
import { Pill } from '../../../components/Pill';
import {
  Ledger,
  LedgerHead,
  LedgerBody,
  NumCell,
  LabelCell,
} from '../../../components/Ledger';
import { SourceStamp } from '../../../components/SourceStamp';
import { GlossaryTerm } from '../../../components/GlossaryTerm';
import { DistressBar } from '../../../components/DistressBar';
import { ValueDerivationDrawer } from '../../../components/ValueDerivationDrawer';
import { CommunitySignal } from '../../../components/CommunitySignal';
import { Button } from '../../../components/Button';
import {
  ContextRail,
  RailProvider,
  type ContextRailProps,
} from '../../../components/ContextRail';

function usd(n: number | null): string {
  return n == null ? '—' : `$${n.toLocaleString('en-US')}`;
}
function usdK(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}
/** Format an already-percent value (change_since_sale_pct is in PERCENT units,
 *  e.g. 87.1 ⇒ "+87%") — do NOT re-scale by 100. */
function pct(n: number | null): string {
  return n == null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n)}%`;
}
function mmYYYY(iso: string | null): string {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  return `${m} / ${y}`;
}
/** Atlas deep link for a parcel's deeds / L&I records (mirror of lib/parcel-query). */
function atlasUrl(address: string): string {
  return `https://atlas.phila.gov/${encodeURIComponent(address)}`;
}
/** Whole years between an ISO date and today, derived (never hardcoded). */
function yearsSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const yrs = (Date.now() - then) / (365.25 * 24 * 3600 * 1000);
  return yrs > 0 ? yrs : null;
}

const RAIL_STATIC: ContextRailProps['staticBlocks'] = [
  {
    term: 'CLR',
    rule: true,
    body:
      'Common Level Ratio — the factor the state uses to line up an assessed value with what properties actually sell for. When the assessment looks high against the comps, the CLR is the lever you check first.',
    src: 'PA State Tax Equalization Board, 2026',
  },
  {
    term: 'SOURCE STAMPS',
    body:
      "Every figure on this page carries its origin. [OPA] is the assessor, [RTT] is the recorded deed, [L&I] is licenses & inspections, [REV] is the Revenue Dept, [SHERIFF] is a sheriff-sale record. Numbers don't lie — people do. Here's the record.",
  },
];

/** Maps a transfer to its sale-history pill. */
function transferPill(t: ParcelDeepDive['transfers'][number]) {
  if (t.is_sheriff) {
    const yr = t.recording_date.slice(2, 4);
    return <Pill kind="aged">SHERIFF &apos;{yr}</Pill>;
  }
  if (t.is_estate_or_nonmarket) return <Pill kind="aged">ESTATE</Pill>;
  if (t.is_arms_length) return <Pill kind="neutral">ARMS-LENGTH</Pill>;
  return <Pill kind="neutral">{t.document_type}</Pill>;
}

/**
 * How many comps the deep-dive paints. `CompsResult.comps` is the full p5/p95-
 * trimmed pool — every sale feeding `distribution` and the estimate — which runs
 * to 200+ in a dense neighborhood (the widening ladder floors the sample at N≥5
 * but never caps it). This is a DISPLAY cap only; the estimate is unchanged.
 */
const COMP_DISPLAY_CAP = 8;

/**
 * Curate the comps the page renders out of the full trimmed pool. Always keep
 * the median (it sets the number) and the near-trim-boundary context comps, fill
 * the rest with the nearest, dedupe repeat-sale parcels, then cap and show
 * nearest-first. Selection/trim/estimate math (in core) is untouched.
 */
function curateComps(comps: Comp[], cap: number): Comp[] {
  const pinned = comps.filter((c) => c.reason.is_median || c.reason.near_trim_boundary);
  const rest = comps.filter((c) => !c.reason.is_median && !c.reason.near_trim_boundary);
  const seen = new Set<string>();
  const out: Comp[] = [];
  for (const c of [...pinned, ...rest]) {
    if (seen.has(c.parcel_pk)) continue;
    seen.add(c.parcel_pk);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out.sort((a, b) => a.reason.distance_mi - b.reason.distance_mi);
}

/**
 * L&I status strings are free-text and wildly inconsistent (OPEN, Issued,
 * COMPLIED, RESOLVE, CLOSEDCASE, Cancelled, null …). Rather than match exact
 * literals, classify tolerantly: a record is "closed/resolved" if its status
 * contains any settled token; everything else (incl. null/empty) is treated as
 * still-open. Keeps the page honest without inventing a status we don't have.
 */
const CLOSED_TOKENS = [
  'close',
  'complied',
  'comply',
  'cmply',
  'compexcp',
  'resolve',
  'complete',
  'cancel',
  'expired',
  'revoked',
  'abandoned',
  'denied',
  'refused',
  'demolish',
  'error',
];
function isClosedStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return CLOSED_TOKENS.some((t) => s.includes(t));
}
/** A permit reads as "open" when it is issued/active and not settled. */
function isOpenPermit(l: ParcelDeepDive['li'][number]): boolean {
  return l.kind === 'permit' && !isClosedStatus(l.status);
}
/** A violation reads as "open" when it is not settled (incl. null status). */
function isOpenViolation(l: ParcelDeepDive['li'][number]): boolean {
  return l.kind === 'violation' && !isClosedStatus(l.status);
}

/** A distress component is "weighing on" the parcel when it adds points. */
function contributingLabels(data: ParcelDeepDive): string[] {
  return data.distress.components
    .filter((c) => c.contribution > 0)
    .sort((x, y) => y.contribution - x.contribution)
    .map((c) => c.label.toLowerCase());
}

/** Has a given distress component present + contributing? (gates honest copy). */
function hasSignal(data: ParcelDeepDive, key: string): boolean {
  return data.distress.components.some((c) => c.component === key && c.contribution > 0);
}

export function DeepDive({ data }: { data: ParcelDeepDive }) {
  const p = data.parcel;
  const a = data.assessment_vs_sale;
  // Only clauses where the value actually exists — no guessed ROW/1BA defaults.
  const subaddr = [
    `OPA ${p.parcel_pk}`,
    p.lat != null && p.lon != null ? `LAT ${p.lat} LON ${p.lon}` : null,
    p.zoning ? `ZONING ${p.zoning}` : null,
    p.beds != null ? `${p.beds} BR` : null,
    p.livable_area != null ? `${p.livable_area.toLocaleString('en-US')} SF` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const shownComps = curateComps(data.comps.comps, COMP_DISPLAY_CAP);
  const totalTrimmed = data.comps.distribution.n_trimmed;

  // L&I — type/latest from the real records (li array is already date-desc).
  const openPermit = data.li.find(isOpenPermit);
  const openViolations = data.li.filter(isOpenViolation);
  const openViolation = openViolations[0];
  // COUNT comes from the authoritative distress matview component (uncapped), not
  // the li array (parcel-query caps it) — so this never undercounts or contradicts
  // the distress card's open-violations figure on the same page.
  const openViolComponent = data.distress.components.find((c) => c.component === 'open_violations');
  const openViolationCount =
    typeof openViolComponent?.raw_value === 'number'
      ? openViolComponent.raw_value
      : openViolations.length;
  const closedViolations = data.li.filter(
    (l) => l.kind === 'violation' && isClosedStatus(l.status),
  ).length;

  // Comps — radius + recency describe the FULL trimmed pool the estimate uses (N =
  // n_trimmed), NOT just the curated 8 we paint, so the "≤ X mi · ≤ Y MO" bounds
  // match the N they sit beside.
  const maxDist = data.comps.comps.length
    ? Math.max(...data.comps.comps.map((c) => c.reason.distance_mi))
    : 0;
  const compBarMax =
    Math.max(
      ...shownComps.map((c) => c.price_per_sqft ?? 0),
      data.comps.distribution.p95 ?? 0,
    ) || 1;
  const oldestCompDate = data.comps.comps.reduce<string | null>(
    (oldest, c) => (oldest === null || c.sale_date < oldest ? c.sale_date : oldest),
    null,
  );
  const compMonths = (() => {
    const yrs = yearsSince(oldestCompDate);
    return yrs == null ? null : Math.max(1, Math.ceil(yrs * 12));
  })();

  // "Change since last sale" copy, derived from the real sale_date.
  const saleYears = yearsSince(p.sale_date);
  const changeSub = (() => {
    if (a.change_since_sale_pct == null) return 'no arms-length sale on record';
    if (saleYears == null || saleYears < 1) return null;
    const yrs = Math.round(saleYears);
    // Compounded annual growth from the real total change over the real span.
    const annual =
      Math.round((Math.pow(1 + a.change_since_sale_pct / 100, 1 / saleYears) - 1) * 1000) / 10;
    return `over ${yrs} yr${yrs === 1 ? '' : 's'} · ~${annual}% / yr`;
  })();

  // Distress intro — generated from the contributing components (top 3).
  const distressIntro = (() => {
    const labels = contributingLabels(data).slice(0, 3);
    if (labels.length === 0) {
      return 'Nothing in the public record flags this parcel as distressed.';
    }
    const count = ['One thing', 'Two things', 'Three things'][labels.length - 1];
    const verb = labels.length === 1 ? 'weighs' : 'weigh';
    const joined =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return `${count} ${verb} on this parcel: ${joined}. Tap a segment to see the receipt.`;
  })();

  // Community-signal copy — recovery (not flip) framing, every clause gated on a
  // REAL signal/field. No fabricated counts, no invented vacancy duration.
  const communityCopy = (() => {
    const where = p.neighborhood_name ? `on ${p.neighborhood_name}` : 'on this block';
    const clauses: string[] = [];
    if (hasSignal(data, 'vacancy_proxy')) clauses.push('reads as vacant in the public record');
    if (hasSignal(data, 'tax_delinquent')) clauses.push("it's behind on taxes");
    const lead =
      clauses.length > 0
        ? `This one ${where} ${clauses.join(' and ')}`
        : `This one ${where} is quiet in the record`;
    const age = p.year_built ? ` The bones go back to ${p.year_built}.` : '';
    return `${lead}. Bring it back and that's a home returned to the block, not another shell — recovery, not a flip.${age}`;
  })();

  // Tax card freshness copy, derived from real status + balance.
  const taxBalance = data.tax.balance_with_penalty.value;
  const taxFreshness =
    data.tax.status === 'delinquent' && taxBalance != null
      ? `Owes ${usd(taxBalance)} in back taxes · Revenue Dept, refreshed nightly.`
      : data.tax.status === 'current'
        ? 'No delinquency on record · Revenue Dept.'
        : 'No Revenue Dept delinquency record for this parcel.';

  // Save-this-lead inline state (no new imports; plain fetch).
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'signin' | 'error'>(
    'idle',
  );
  async function saveLead() {
    if (saveState === 'saving' || saveState === 'saved') return;
    setSaveState('saving');
    try {
      const res = await fetch('/api/leads/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parcel_pk: p.parcel_pk }),
      });
      if (res.status === 401) setSaveState('signin');
      else if (res.ok) setSaveState('saved');
      else setSaveState('error');
    } catch {
      setSaveState('error');
    }
  }
  const saveLabel =
    saveState === 'saved'
      ? 'SAVED ✓'
      : saveState === 'saving'
        ? 'SAVING…'
        : saveState === 'signin'
          ? 'SIGN IN TO SAVE'
          : saveState === 'error'
            ? 'TRY AGAIN →'
            : 'SAVE THIS LEAD →';

  const neighborhood = p.neighborhood_name ?? '—';
  const atlasHref = atlasUrl(p.address);

  return (
    <RailProvider>
      <span className="sr-only">
        Property deep-dive for {p.address} in {neighborhood}, Philadelphia:
        assessment, sale history, permits, comparable sales, value estimate, and a
        decomposable distress score.
      </span>

      <header className="pb-header">
        <Wordmark variant="boxed" />
        <div className="pb-header-id">
          <p className="pb-eyebrow">
            PARCEL DEEP-DIVE · {(p.neighborhood_name ?? '').toUpperCase()} /{' '}
            {p.zip ?? ''}
          </p>
          <h1 className="pb-address">{p.address}</h1>
          <p className="pb-subaddr">{subaddr}</p>
        </div>
        <ThemeToggle variant="ink" labelStyle="long" />
      </header>

      <div className="pb-shell-dd">
        <main className="pb-main">
          {/* Assessment vs last sale */}
          <Card
            frame
            title="Assessment vs. last sale"
            tally="TAX YEAR 2026"
            headingId="assessHead"
            aria-labelledby="assessHead"
          >
            <MetricStrip>
              <MetricCell
                label="Market value (assessed)"
                value={usd(a.market_value.value)}
                sub={
                  <>
                    <SourceStamp code="opa" href={a.market_value.source_url || undefined} dotted>
                      OPA
                    </SourceStamp>
                    {p.category_code ? ` · CLASS ${p.category_code}` : ''}
                    {p.zoning ? ` · ${p.zoning}` : ''}
                  </>
                }
              />
              <MetricCell
                emphasis="featured"
                label="Last recorded sale"
                value={usd(a.last_sale.value)}
                sub={
                  <>
                    <SourceStamp code="opa" href={a.last_sale.source_url || undefined} dotted>
                      OPA
                    </SourceStamp>{' '}
                    · {mmYYYY(p.sale_date)}
                  </>
                }
              />
            </MetricStrip>
            <MetricStrip joinTop>
              <MetricCell
                label="Assessed $ / SF"
                value={usd(a.assessed_psf.value)}
                sub={
                  p.livable_area != null ? (
                    <>
                      <SourceStamp code="opa" href={a.assessed_psf.source_url || undefined} dotted>
                        OPA
                      </SourceStamp>{' '}
                      · {p.livable_area.toLocaleString('en-US')} SF livable
                    </>
                  ) : (
                    <SourceStamp code="opa" href={a.assessed_psf.source_url || undefined} dotted>
                      OPA
                    </SourceStamp>
                  )
                }
              />
              <MetricCell
                label="Change since last sale"
                value={pct(a.change_since_sale_pct)}
                sub={changeSub}
              />
            </MetricStrip>
            <div className="pb-actions" style={{ marginTop: 'var(--pb-space-5)', gap: 'var(--pb-space-5)' }}>
              <SourceStamp code="opa" href={a.market_value.source_url || undefined}>
                {a.market_value.source_stamp}
              </SourceStamp>
            </div>
            <p className="pb-freshness">
              Where this comes from · OPA certified roll, refreshed nightly.
            </p>
          </Card>

          {/* Sale history */}
          <Card
            title="Sale history"
            tally={`${data.transfers.length} RECORDED TRANSFER${data.transfers.length === 1 ? '' : 'S'}`}
            headingId="saleHead"
            aria-labelledby="saleHead"
          >
            <Ledger>
              <LedgerHead columns={['Date', 'Price', 'Type', 'Source']} />
              <LedgerBody>
                {data.transfers.length === 0 ? (
                  <tr>
                    <LabelCell>No recorded deeds in the index for this parcel.</LabelCell>
                  </tr>
                ) : (
                  data.transfers.map((t) => (
                    <tr key={t.transfer_id}>
                      <NumCell>{mmYYYY(t.recording_date)}</NumCell>
                      <NumCell>
                        <SourceStamp code={t.is_sheriff ? 'sheriff' : 'rtt'} href={atlasHref} dotted>
                          {usd(t.total_consideration)}
                        </SourceStamp>
                      </NumCell>
                      <LabelCell>{transferPill(t)}</LabelCell>
                      <NumCell>
                        <SourceStamp code={t.is_sheriff ? 'sheriff' : 'rtt'} href={atlasHref}>
                          {t.source_stamp}
                        </SourceStamp>
                      </NumCell>
                    </tr>
                  ))
                )}
              </LedgerBody>
            </Ledger>
            <p className="pb-freshness">
              Where this comes from · Records Dept deed index, refreshed nightly.
            </p>
          </Card>

          {/* Permits/violations + Taxes */}
          <section className="pb-twocol">
            <Card title="Permits & violations" tally="L&I" headingId="liHead" aria-labelledby="liHead">
              <Ledger>
                <LedgerBody>
                  <tr>
                    <LabelCell>Open building permit</LabelCell>
                    <NumCell>
                      <Pill kind="blue">{openPermit?.type_code ?? 'NONE'}</Pill>
                    </NumCell>
                    <NumCell>
                      {openPermit ? (
                        <SourceStamp code="li" href={atlasHref}>
                          {openPermit.source_stamp}
                        </SourceStamp>
                      ) : (
                        <SourceStamp code="li" href={atlasHref}>
                          [L&amp;I]
                        </SourceStamp>
                      )}
                    </NumCell>
                  </tr>
                  <tr>
                    <LabelCell>Open violation</LabelCell>
                    <NumCell>
                      {openViolationCount > 0 ? (
                        <Pill kind="danger">
                          {openViolation?.type_code ?? 'OPEN'} · {openViolationCount}
                        </Pill>
                      ) : (
                        <Pill kind="neutral">NONE</Pill>
                      )}
                    </NumCell>
                    <NumCell>
                      {openViolation ? (
                        <SourceStamp code="li" href={atlasHref}>
                          {openViolation.source_stamp}
                        </SourceStamp>
                      ) : (
                        <SourceStamp code="li" href={atlasHref}>
                          [L&amp;I]
                        </SourceStamp>
                      )}
                    </NumCell>
                  </tr>
                  <tr>
                    <LabelCell>Closed violations</LabelCell>
                    <NumCell>{closedViolations}</NumCell>
                    <NumCell>
                      <SourceStamp code="li" href={atlasHref}>
                        [L&amp;I]
                      </SourceStamp>
                    </NumCell>
                  </tr>
                </LedgerBody>
              </Ledger>
              <p className="pb-freshness">
                Where this comes from · L&amp;I permit &amp; violation index, refreshed nightly.
              </p>
            </Card>

            <Card title="Taxes" tally="REVENUE DEPT" headingId="taxHead" aria-labelledby="taxHead">
              <Ledger>
                <LedgerBody>
                  <tr>
                    <LabelCell>Status</LabelCell>
                    <NumCell>
                      <Pill kind={data.tax.status === 'delinquent' ? 'danger' : 'neutral'}>
                        {data.tax.status.toUpperCase()}
                      </Pill>
                    </NumCell>
                    <NumCell>
                      <SourceStamp code="rev" href={data.tax.balance_with_penalty.source_url || undefined}>
                        [REV]
                      </SourceStamp>
                    </NumCell>
                  </tr>
                  <tr>
                    <LabelCell>Balance + penalty</LabelCell>
                    <NumCell>
                      <SourceStamp
                        code="rev"
                        href={data.tax.balance_with_penalty.source_url || undefined}
                        dotted
                      >
                        {usd(data.tax.balance_with_penalty.value)}
                      </SourceStamp>
                    </NumCell>
                    <NumCell>
                      <SourceStamp code="rev" href={data.tax.balance_with_penalty.source_url || undefined}>
                        [REV]
                      </SourceStamp>
                    </NumCell>
                  </tr>
                </LedgerBody>
              </Ledger>
              <p className="pb-freshness">{taxFreshness}</p>
            </Card>
          </section>

          {/* Comps + value derivation */}
          <Card
            frame
            title={`Comps · arms-length, ≤ ${maxDist.toFixed(2)} mi`}
            tally={`N = ${totalTrimmed}${compMonths != null ? ` · ≤ ${compMonths} MO` : ''}`}
            headingId="compHead"
            aria-labelledby="compHead"
          >
            {shownComps.map((c) => {
              const flag = c.reason.is_median ? 'MEDIAN' : 'WHY';
              const widthPct = c.price_per_sqft
                ? Math.max(4, Math.round((c.price_per_sqft / compBarMax) * 100))
                : 80;
              const fillClass = c.reason.is_median
                ? 'pb-bar-fill--brick'
                : c.reason.distance_mi <= 0.05
                  ? 'pb-bar-fill--blue'
                  : 'pb-bar-fill--sky';
              return (
                <div className="pb-comp" key={c.parcel_pk}>
                  <div className="pb-comp-top">
                    <span className="pb-comp-addr">{c.address}</span>
                    <span className="pb-comp-psf">
                      ${c.price_per_sqft} / SF · {usdK(c.sale_price)}
                    </span>
                  </div>
                  <div className="pb-bar-track">
                    <div className={`pb-bar-fill ${fillClass}`} style={{ width: `${widthPct}%` }} />
                  </div>
                  <p className="pb-why">
                    <span className="pb-whyflag">{flag}</span>
                    {c.reason.note}{' '}
                    <SourceStamp code="rtt" href={c.source_url || undefined}>
                      {c.source_stamp}
                    </SourceStamp>
                  </p>
                </div>
              );
            })}

            {totalTrimmed > shownComps.length && (
              <p className="pb-freshness">
                Showing the {shownComps.length} most relevant of {totalTrimmed}{' '}
                arms-length comps — the estimate below uses all {totalTrimmed}.
              </p>
            )}

            <ValueDerivationDrawer comps={data.comps} livableArea={p.livable_area} />

            <p className="pb-freshness">
              Where this comes from · arms-length deeds (RTT), comp set rebuilt nightly.
            </p>
          </Card>

          {/* Distress score (the one red hero + decomposable bar) */}
          <Card
            frame
            title="Distress score"
            tally="0–100 · HIGHER = MORE DISTRESS"
            headingId="distHead"
            aria-labelledby="distHead"
          >
            <div className="pb-distress-score">
              <p className="pb-mlabel">DISTRESS</p>
              <p className="pb-mval">{data.distress.score100}</p>
            </div>

            <DistressBar result={data.distress} intro={distressIntro} />

            <CommunitySignal>{communityCopy}</CommunitySignal>

            <div className="pb-actions">
              <Button variant="primary" onClick={saveLead}>
                {saveLabel}
              </Button>
              <Button variant="secondary">ADD NOTE +</Button>
              <Button variant="ghost">EXPORT RECORD</Button>
            </div>
          </Card>
        </main>

        <ContextRail
          heading="The file, explained"
          intro={
            <>
              Tap any dotted term in the file and the plain-English version opens
              right here — like a margin note from someone who actually lives on
              the block. Try <GlossaryTerm term="clr">CLR</GlossaryTerm>,{' '}
              <GlossaryTerm term="armslength">arms-length</GlossaryTerm>, or{' '}
              <GlossaryTerm term="distress">distress score</GlossaryTerm>.
            </>
          }
          staticBlocks={RAIL_STATIC}
        />
      </div>

      <footer className="pb-foot">
        BANDBOX · KNOW THE BLOCK BEFORE YOU KNOCK · DATA: OPA · RTT · L&amp;I ·
        REVENUE · SHERIFF
      </footer>
    </RailProvider>
  );
}
