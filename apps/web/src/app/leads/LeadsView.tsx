'use client';

/**
 * LeadsView — the Leads surface client shell (PRD §7.3). Owns the filter state,
 * debounced-fetches the scored list (/api/leads) and the honest per-signal counts
 * (/api/leads?facets=1) on every filter change, and renders the controlled
 * <FilterRail/> (left) beside the <LeadsTable/> (right). "Export CSV" hits
 * /api/leads/export with the same filters; export is free for authenticated
 * users (monetization deferred to M8), so a 401 surfaces "Sign in to export"
 * rather than a download. Pagination is Load-more (append pages).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LeadRow, LeadsResponse, LeadFacets } from '@bandbox/core/contracts';
import { FilterRail, type FilterRailValue } from '../../components/FilterRail';
import { LeadsTable } from '../../components/LeadsTable';
import { Button } from '../../components/Button';

const PAGE_SIZE = 50;

// A leads list should default to actually-distressed parcels, not every parcel.
// score01 ≥ 0.30 is ~4.1k city-wide leads (vs ~198k with any signal at all) —
// a curated, workable default; the Distress Floor slider lowers it to "Any".
const DEFAULT_MIN_SCORE = 0.3;

const EMPTY_FILTER: FilterRailValue = {
  minScore: DEFAULT_MIN_SCORE,
  signals: new Set<string>(),
  neighborhood: '',
  maxValue: null,
  saleBefore: '',
};

/** Build the shared query string for /api/leads and /api/leads/export. */
function filterToParams(f: FilterRailValue): URLSearchParams {
  const p = new URLSearchParams();
  if (f.minScore > 0) p.set('min_score', String(f.minScore));
  for (const s of f.signals) p.append('signal', s);
  if (f.maxValue != null) p.set('max_value', String(f.maxValue));
  if (/^\d{4}$/.test(f.saleBefore)) p.set('sale_before', f.saleBefore);
  if (f.neighborhood.trim() !== '') p.set('neighborhood', f.neighborhood.trim());
  return p;
}

export function LeadsView() {
  const [filter, setFilter] = useState<FilterRailValue>(EMPTY_FILTER);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [facets, setFacets] = useState<LeadFacets | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  // A stable serialization of the filter, so the debounced effect only refires on
  // a real change (Set identity would otherwise refire every render).
  const filterKey = useMemo(() => filterToParams(filter).toString(), [filter]);

  // Debounced fetch of page 0 + facets whenever the filter changes.
  const reqId = useRef(0);
  useEffect(() => {
    const handle = setTimeout(() => {
      const id = ++reqId.current;
      setLoading(true);
      setPage(0);
      const params = new URLSearchParams(filterKey);
      params.set('page', '0');
      params.set('page_size', String(PAGE_SIZE));
      const facetParams = new URLSearchParams(filterKey);
      facetParams.set('facets', '1');

      Promise.all([
        fetch(`/api/leads?${params.toString()}`).then((r) => r.json() as Promise<LeadsResponse>),
        fetch(`/api/leads?${facetParams.toString()}`).then((r) => r.json() as Promise<LeadFacets>),
      ])
        .then(([list, fac]) => {
          if (id !== reqId.current) return; // a newer request won
          setRows(list.rows ?? []);
          setTotal(list.total ?? 0);
          setFacets(fac ?? null);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setRows([]);
          setTotal(0);
          setFacets(null);
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [filterKey]);

  const loadMore = useCallback(() => {
    const next = page + 1;
    // Tie this append to the current request generation. A filter change bumps
    // reqId (the debounced effect), so an in-flight Load-more whose page-0 fetch
    // for the NEW filter has already landed will bail here instead of grafting
    // OLD-filter rows onto the new set.
    const id = reqId.current;
    setLoading(true);
    const params = new URLSearchParams(filterKey);
    params.set('page', String(next));
    params.set('page_size', String(PAGE_SIZE));
    fetch(`/api/leads?${params.toString()}`)
      .then((r) => r.json() as Promise<LeadsResponse>)
      .then((list) => {
        if (id !== reqId.current) return; // a filter change superseded this load
        setRows((prev) => [...prev, ...(list.rows ?? [])]);
        setPage(next);
      })
      .catch(() => {})
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [filterKey, page]);

  const onExport = useCallback(async () => {
    setExportMsg(null);
    try {
      const res = await fetch(`/api/leads/export?${filterKey}`);
      if (res.status === 401 || res.status === 403) {
        setExportMsg('Sign in to export');
        return;
      }
      if (!res.ok) {
        setExportMsg('Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'leads-export.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportMsg('Export failed');
    }
  }, [filterKey]);

  const onSave = useCallback(async (parcelPk: string) => {
    // The mini-CRM save endpoint is owned by another stream; we call its frozen
    // shape (POST /api/leads/save { parcel_pk }). Failures are non-fatal here.
    try {
      await fetch('/api/leads/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parcel_pk: parcelPk }),
      });
    } catch {
      /* surfaced by the CRM stream's own UI; no-op here */
    }
  }, []);

  const facetCounts = facets?.by_signal;
  const hasMore = rows.length < total;

  return (
    <div className="pb-shell-scan pb-leads-shell">
      <FilterRail
        value={filter}
        onChange={setFilter}
        facets={facetCounts}
        onReset={() => setFilter({ ...EMPTY_FILTER, signals: new Set<string>() })}
      />

      <main className="pb-mapcol pb-leads-col">
        <div className="pb-maphead">
          <div>
            <p className="pb-kicker">Score the city. Work the list.</p>
            <h1>Leads</h1>
          </div>
          <div className="pb-leads-actions">
            <span className="pb-leads-total" aria-live="polite">
              {total.toLocaleString('en-US')} leads
            </span>
            <Button variant="primary" onClick={onExport}>
              Export CSV →
            </Button>
          </div>
        </div>

        {exportMsg ? (
          <p className="pb-leads-exportmsg" role="status">
            {exportMsg}
          </p>
        ) : null}

        <div className="pb-leads-tablewrap" aria-busy={loading}>
          {rows.length === 0 && !loading ? (
            <p className="pb-leads-empty">No leads match these filters.</p>
          ) : (
            <LeadsTable rows={rows} onSave={onSave} />
          )}
        </div>

        <div className="pb-leads-more">
          {hasMore ? (
            <Button variant="secondary" onClick={loadMore} disabled={loading}>
              Load more
            </Button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
