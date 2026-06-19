/**
 * Route "/leads" — the Leads surface (PRD §7.3): a scored, filterable distress
 * list with an honest-count filter rail and a paid CSV export. Server component
 * shell delegating to the client <LeadsView> (which owns the filter state and the
 * debounced list/facets fetches). `force-dynamic` because every render reflects
 * live, filter-dependent data — nothing here is statically cacheable.
 */
import type { Metadata } from 'next';
import { TopBand } from '../../components/TopBand';
import { LeadsView } from './LeadsView';
import './leads.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leads — Bandbox',
  description: 'Scored, filterable distress leads with honest per-signal counts and CSV export.',
};

export default function Page() {
  return (
    <div className="pb-app">
      <TopBand current="Leads" />
      <LeadsView />
    </div>
  );
}
