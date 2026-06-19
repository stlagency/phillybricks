/**
 * GET /api/comps?pk=… — comp set + distribution + transparent value estimate
 * (PRD §6, §5.2). Thin wrapper over computeComps() (the shared subject+candidate
 * load + core selectComps ladder/trim/land branch). Returns the frozen CompsResult.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { computeComps } from '../../../lib/comps-query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const pk = new URL(req.url).searchParams.get('pk');
  if (!pk) return NextResponse.json({ error: 'pk required' }, { status: 400 });
  const result = await computeComps(db(), pk);
  if (result === null) return NextResponse.json({ error: 'parcel not found' }, { status: 404 });
  return NextResponse.json(result);
}
