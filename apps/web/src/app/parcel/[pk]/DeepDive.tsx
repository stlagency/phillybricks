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
import type { ParcelDeepDive } from '@phillybricks/core/contracts';
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
function pct(n: number | null): string {
  return n == null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`;
}
function mmYYYY(iso: string | null): string {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  return `${m} / ${y}`;
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
      "Every figure on this page carries its origin. [OPA] is the assessor, [RTT] is the recorded deed, [L&I] is licenses & inspections, [REV] is the Revenue Dept, [SHERIFF '03] is the 2003 sheriff sale. Numbers don't lie — people do. Here's the record.",
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

export function DeepDive({ data }: { data: ParcelDeepDive }) {
  const p = data.parcel;
  const a = data.assessment_vs_sale;
  const subaddr =
    `OPA ${p.parcel_pk}` +
    (p.lat != null && p.lon != null ? ` · LAT ${p.lat} LON ${p.lon}` : '') +
    ` · ${p.category_code === '1' ? 'ROW' : (p.category_code ?? '—')}` +
    (p.beds != null ? ` · ${p.beds}BR/1BA` : '') +
    (p.livable_area != null ? ` · ${p.livable_area.toLocaleString('en-US')} SF` : '');

  const openPermit = data.li.find((l) => l.kind === 'permit' && l.status === 'open');
  const openViolation = data.li.find((l) => l.kind === 'violation' && l.status === 'open');
  const closedViolations = data.li.filter(
    (l) => l.kind === 'violation' && l.status === 'closed',
  ).length;

  return (
    <RailProvider>
      <span className="sr-only">
        Property deep-dive for {p.address} in Fishtown, Philadelphia: assessment,
        sale history, permits, comparable sales, value estimate, and a
        decomposable distress score.
      </span>

      <header className="pb-header">
        <Wordmark variant="boxed" />
        <div className="pb-header-id">
          <p className="pb-eyebrow">
            PARCEL DEEP-DIVE · FISHTOWN / {p.zip ?? ''}
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
                    <SourceStamp code="opa" dotted>
                      OPA
                    </SourceStamp>{' '}
                    · land $58k · bldg $183k
                  </>
                }
              />
              <MetricCell
                emphasis="featured"
                label="Last recorded sale"
                value={usd(a.last_sale.value)}
                sub={
                  <>
                    <SourceStamp code="rtt" dotted>
                      RECORDS DEPT
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
                  <>
                    <SourceStamp code="opa" dotted>
                      OPA
                    </SourceStamp>{' '}
                    · {p.livable_area?.toLocaleString('en-US')} SF livable
                  </>
                }
              />
              <MetricCell
                label="Change since last sale"
                value={pct(a.change_since_sale_pct)}
                sub="over 12 yrs · ~5.4% / yr"
              />
            </MetricStrip>
            <div className="pb-actions" style={{ marginTop: 'var(--pb-space-5)', gap: 'var(--pb-space-5)' }}>
              <SourceStamp code="opa">{a.market_value.source_stamp}</SourceStamp>
              <SourceStamp code="rtt">[RECORDS DEPT · RTT]</SourceStamp>
            </div>
            <p className="pb-freshness">
              Where this comes from · OPA certified value, refreshed 6 days ago.
            </p>
          </Card>

          {/* Sale history */}
          <Card title="Sale history" tally="3 RECORDED TRANSFERS" headingId="saleHead" aria-labelledby="saleHead">
            <Ledger>
              <LedgerHead columns={['Date', 'Price', 'Type', 'Source']} />
              <LedgerBody>
                {data.transfers.map((t) => (
                  <tr key={t.transfer_id}>
                    <NumCell>{mmYYYY(t.recording_date)}</NumCell>
                    <NumCell>
                      <SourceStamp code={t.is_sheriff ? 'sheriff' : 'rtt'} dotted>
                        {usd(t.total_consideration)}
                      </SourceStamp>
                    </NumCell>
                    <LabelCell>{transferPill(t)}</LabelCell>
                    <NumCell>
                      <SourceStamp code={t.is_sheriff ? 'sheriff' : 'rtt'}>
                        {t.source_stamp}
                      </SourceStamp>
                    </NumCell>
                  </tr>
                ))}
              </LedgerBody>
            </Ledger>
            <p className="pb-freshness">
              Where this comes from · Records Dept deed index, refreshed 11 days ago.
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
                      <SourceStamp code="li">[L&amp;I &apos;25]</SourceStamp>
                    </NumCell>
                  </tr>
                  <tr>
                    <LabelCell>Open violation</LabelCell>
                    <NumCell>
                      <Pill kind="danger">{openViolation?.type_code ?? 'NONE'} · 1</Pill>
                    </NumCell>
                    <NumCell>
                      <SourceStamp code="li">[L&amp;I &apos;24]</SourceStamp>
                    </NumCell>
                  </tr>
                  <tr>
                    <LabelCell>Closed violations</LabelCell>
                    <NumCell>{closedViolations}</NumCell>
                    <NumCell>
                      <SourceStamp code="li">[L&amp;I]</SourceStamp>
                    </NumCell>
                  </tr>
                </LedgerBody>
              </Ledger>
              <p className="pb-freshness">Refreshed 3 days ago.</p>
            </Card>

            <Card title="Taxes" tally="REVENUE DEPT" headingId="taxHead" aria-labelledby="taxHead">
              <Ledger>
                <LedgerBody>
                  <tr>
                    <LabelCell>2026 RE tax billed</LabelCell>
                    <NumCell>
                      <SourceStamp code="rev" dotted>
                        {usd(data.tax.billed.value)}
                      </SourceStamp>
                    </NumCell>
                    <NumCell>
                      <SourceStamp code="rev">[REV]</SourceStamp>
                    </NumCell>
                  </tr>
                  <tr>
                    <LabelCell>Status</LabelCell>
                    <NumCell>
                      <Pill kind={data.tax.status === 'delinquent' ? 'danger' : 'neutral'}>
                        {data.tax.status.toUpperCase()}
                      </Pill>
                    </NumCell>
                    <NumCell>
                      <SourceStamp code="rev">[REV]</SourceStamp>
                    </NumCell>
                  </tr>
                  <tr>
                    <LabelCell>Balance + penalty</LabelCell>
                    <NumCell>
                      <SourceStamp code="rev" dotted>
                        {usd(data.tax.balance_with_penalty.value)}
                      </SourceStamp>
                    </NumCell>
                    <NumCell>
                      <SourceStamp code="rev">[REV]</SourceStamp>
                    </NumCell>
                  </tr>
                </LedgerBody>
              </Ledger>
              <p className="pb-freshness">Two years behind. Refreshed 3 days ago.</p>
            </Card>
          </section>

          {/* Comps + value derivation */}
          <Card
            frame
            title="Comps · arms-length, ≤ 0.3 mi"
            tally={`N = ${data.comps.distribution.n_trimmed} · 12 MO`}
            headingId="compHead"
            aria-labelledby="compHead"
          >
            {data.comps.comps.map((c, i) => {
              const flag = c.reason.is_median ? 'MEDIAN' : 'WHY';
              const widthPct = c.price_per_sqft
                ? Math.round((c.price_per_sqft / 256) * 100)
                : 80;
              const fillClass = c.reason.is_median
                ? 'pb-bar-fill--brick'
                : c.reason.distance_mi <= 0.05
                  ? 'pb-bar-fill--blue'
                  : 'pb-bar-fill--sky';
              return (
                <div className="pb-comp" key={`${c.parcel_pk}-${i}`}>
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
                    <SourceStamp code="rtt">{c.source_stamp}</SourceStamp>
                  </p>
                </div>
              );
            })}

            <ValueDerivationDrawer comps={data.comps} livableArea={p.livable_area} />

            <p className="pb-freshness">
              Where this comes from · comp set rebuilt nightly, refreshed 1 day ago.
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

            <DistressBar
              result={data.distress}
              intro={
                <>
                  Three things weigh on this parcel: it&apos;s behind on taxes, it
                  carries an open unsafe violation, and it&apos;s read as vacant.
                  Tap a segment to see the receipt.
                </>
              }
            />

            <CommunitySignal>
              Vacant three-plus years and two years behind on taxes — but the
              bones are good and the block&apos;s already turning. Bring this one
              back and that&apos;s a home returned to Firth Street, not another
              shell. 142 vacant on these blocks · 38 in active rehab this year.
            </CommunitySignal>

            <div className="pb-actions">
              <Button variant="primary">SAVE THIS LEAD →</Button>
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
        PHILLYBRICKS · KNOW THE BLOCK BEFORE YOU KNOCK · DATA: OPA · RTT · L&amp;I ·
        REVENUE · SHERIFF
      </footer>
    </RailProvider>
  );
}
