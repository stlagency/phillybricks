/**
 * GET /api/parcel/:pk — the deep-dive bundle (PRD §6, §7.2). Thin wrapper over
 * lib/parcel-query.ts `loadDeepDive`, which assembles the frozen ParcelDeepDive
 * (parcel core, assessment-vs-sale, transfers, L&I, tax, nearby crime/311, comps,
 * distress decomposition) — shared with the server-rendered deep-dive page.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { loadDeepDive } from '../../../../lib/parcel-query';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pk: string }> },
): Promise<Response> {
  const { pk } = await ctx.params;
  const body = await loadDeepDive(db(), pk);
  if (body === null) return NextResponse.json({ error: 'parcel not found' }, { status: 404 });
  return NextResponse.json(body);
}
