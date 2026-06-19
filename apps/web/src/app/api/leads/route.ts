/**
 * GET /api/leads — scored, paginated distress leads (PRD §6, §7.3). Reads
 * public.distress_signal joined to public.parcel, ordered by composite score, with
 * the M6 filter set (min score, repeated signal toggles [AND], value ceiling, last
 * sale-before year, neighborhood by id OR name). Returns the frozen LeadsResponse;
 * each row carries the full DistressResult decomposition.
 *
 * `?facets=1` returns LeadFacets instead — honest per-signal counts scoped to the
 * SAME filtered set, so a toggle shows how many leads it would (also) surface.
 *
 * The WHERE is built once in lib/leads-query.ts and shared with the CSV export, so
 * the list, the counts, and the exported set can never disagree.
 *
 * NOTE: anon may PREVIEW leads (read-only); save/export require auth only
 * (login-gated, free — monetization deferred to M8) — enforced on those routes,
 * not here.
 */
import { NextResponse } from 'next/server';
import type { LeadsResponse, LeadRow, LeadFacets } from '@bandbox/core/contracts';
import { db } from '../../../lib/db';
import { distressFromRow } from '../../../lib/distress-row';
import { parseLeadsFilter, fetchLeadsPage, countLeads, fetchLeadFacets } from '../../../lib/leads-query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sql = db();
  const filter = parseLeadsFilter(url.searchParams);

  // ?facets=1 — honest per-signal counts for the filter rail (LeadFacets).
  if (url.searchParams.get('facets') === '1') {
    const facets: LeadFacets = await fetchLeadFacets(sql, filter);
    return NextResponse.json(facets);
  }

  const page = Math.max(0, Number(url.searchParams.get('page') ?? '0') || 0);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('page_size') ?? '50') || 50));

  const [rows, total] = await Promise.all([
    fetchLeadsPage(sql, filter, page, pageSize),
    countLeads(sql, filter),
  ]);

  const leadRows: LeadRow[] = rows.map((r) => ({
    parcel_pk: String(r.parcel_pk),
    address: (r.address as string | null) ?? '',
    distress: distressFromRow(r),
    owner_1: (r.owner_1 as string | null) ?? null,
    is_out_of_state_owner: Boolean(r.p_oos),
  }));

  const body: LeadsResponse = {
    rows: leadRows,
    page,
    page_size: pageSize,
    total,
  };
  return NextResponse.json(body);
}
