/**
 * GET /api/leads — scored, paginated distress leads (PRD §6, §7.3). Reads
 * public.distress_signal joined to public.parcel, ordered by composite score, with
 * optional filters (min score, single-signal toggles, neighborhood). Returns the
 * frozen LeadsResponse; each row carries the full DistressResult decomposition.
 *
 * NOTE: anon may PREVIEW leads (read-only); save/export require auth + active sub
 * (M6/M7) — enforced on those write routes, not here.
 */
import { NextResponse } from 'next/server';
import type { LeadsResponse, LeadRow } from '@phillybricks/core/contracts';
import { db } from '../../../lib/db';
import { distressFromRow } from '../../../lib/distress-row';

export const dynamic = 'force-dynamic';

const SIGNAL_FLAGS = new Set([
  'on_sheriff_list',
  'actionable_sheriff_flag',
  'unsafe_or_imm_dang',
  'vacancy_proxy',
  'out_of_state_owner',
]);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? '0') || 0);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('page_size') ?? '50') || 50));
  const minScore = Number(url.searchParams.get('min_score') ?? '0') || 0;
  const neighborhood = url.searchParams.get('neighborhood');
  const flag = url.searchParams.get('signal'); // optional single-signal filter

  const sql = db();
  // Build the dynamic WHERE with bound params (flag name validated against an allowlist).
  const flagClause = flag && SIGNAL_FLAGS.has(flag) ? sql`and ds.${sql(flag)} = true` : sql``;
  const hoodClause = neighborhood ? sql`and p.neighborhood_id = ${neighborhood}` : sql``;

  const rows = await sql<(Record<string, unknown> & { parcel_pk: string })[]>`
    select ds.*, p.address, p.owner_1, p.is_out_of_state_owner as p_oos
    from public.distress_signal ds
    join public.parcel p on p.parcel_pk = ds.parcel_pk
    where ds.score01 >= ${minScore} ${flagClause} ${hoodClause}
    order by ds.score01 desc, ds.parcel_pk
    limit ${pageSize} offset ${page * pageSize}`;

  const totalRow = await sql<{ n: string }[]>`
    select count(*)::text as n
    from public.distress_signal ds
    join public.parcel p on p.parcel_pk = ds.parcel_pk
    where ds.score01 >= ${minScore} ${flagClause} ${hoodClause}`;

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
    total: Number(totalRow[0]?.n ?? '0'),
  };
  return NextResponse.json(body);
}
