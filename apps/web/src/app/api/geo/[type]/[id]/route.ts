/**
 * GET /api/geo/:type/:id — aggregate detail for one geo unit, feeding the Market
 * Scan right rail (PRD §7.1). Validates the geo type, then assembles the frozen
 * GeoDetail from geo_metric + the distress_signal matview aggregated to the geo
 * (see lib/geo-query.ts). Mirrors the /api/parcel/[pk] dynamic-route precedent:
 * invalid type → 400, unknown geo id → 404, valid-but-empty → shaped body.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { isGeoType } from '../../../../../lib/scan-meta';
import { computeGeoDetail } from '../../../../../lib/geo-query';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ type: string; id: string }> },
): Promise<Response> {
  const { type, id } = await ctx.params;
  if (!isGeoType(type)) return NextResponse.json({ error: 'invalid geo type' }, { status: 400 });

  const detail = await computeGeoDetail(db(), type, decodeURIComponent(id));
  if (detail === null) return NextResponse.json({ error: 'geo not found' }, { status: 404 });
  return NextResponse.json(detail);
}
