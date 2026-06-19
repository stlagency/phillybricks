'use client';

/**
 * LeadsTable — the scored leads list (PRD §7.3). Each row is a frozen LeadRow
 * (the same shape /api/leads returns): rank, address (→ deep-dive), the composite
 * distress score with a small inline bar, the lead's top distress signals as
 * Pills, the owner (with an OOS pill when out-of-state), and a per-row actions
 * slot whose Save button calls `onSave(parcel_pk)`.
 *
 * Skip-trace UI is intentionally absent — another stream owns the contact reveal;
 * the actions slot is left open for that integration to wire in.
 */
import Link from 'next/link';
import type { LeadRow } from '@bandbox/core/contracts';
import { Pill } from './Pill';
import { SkipTraceButton } from './SkipTraceButton';

export interface LeadsTableProps {
  rows: LeadRow[];
  /** Called with the parcel_pk when the row's Save button is activated. */
  onSave?: (parcelPk: string) => void;
}

export function LeadsTable({ rows, onSave }: LeadsTableProps) {
  return (
    <table className="pb-leads-table" aria-label="Scored leads">
      <thead>
        <tr>
          <th className="pb-leads-rank" scope="col">
            #
          </th>
          <th scope="col">Address</th>
          <th scope="col">Distress</th>
          <th scope="col">Top signals</th>
          <th scope="col">Owner</th>
          <th className="pb-leads-actcol" scope="col">
            <span className="pb-vh">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          // Top three contributing components (contribution > 0), already score-sorted
          // in the decomposition; render as neutral Pills (no red-budget spend).
          const topSignals = row.distress.components
            .filter((c) => c.contribution > 0)
            .slice(0, 3);
          return (
            <tr key={row.parcel_pk}>
              <td className="pb-leads-rank">{i + 1}</td>
              <td>
                <Link className="pb-leads-addr" href={`/parcel/${row.parcel_pk}`}>
                  {row.address || row.parcel_pk}
                </Link>
              </td>
              <td>
                <div className="pb-leads-score">
                  <span className="pb-leads-scoreval">{row.distress.score100}</span>
                  <span
                    className="pb-leads-bar"
                    role="img"
                    aria-label={`Distress ${row.distress.score100} of 100`}
                  >
                    <span
                      className="pb-leads-barfill"
                      style={{ width: `${Math.min(100, Math.max(0, row.distress.score100))}%` }}
                    />
                  </span>
                </div>
              </td>
              <td>
                <div className="pb-leads-pills">
                  {topSignals.length === 0 ? (
                    <span className="pb-leads-none">—</span>
                  ) : (
                    topSignals.map((c) => (
                      <Pill key={c.component} kind="neutral">
                        {c.label}
                      </Pill>
                    ))
                  )}
                </div>
              </td>
              <td>
                <div className="pb-leads-owner">
                  <span>{row.owner_1 ?? '—'}</span>
                  {row.is_out_of_state_owner ? <Pill kind="aged">OOS</Pill> : null}
                </div>
              </td>
              <td className="pb-leads-actcol">
                {/* Per-row actions: Save to the mini-CRM + BYO skip-trace reveal. */}
                <div className="pb-leads-rowactions">
                  <button
                    type="button"
                    className="pb-leads-save"
                    onClick={() => onSave?.(row.parcel_pk)}
                  >
                    Save
                  </button>
                  <SkipTraceButton parcelPk={row.parcel_pk} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
