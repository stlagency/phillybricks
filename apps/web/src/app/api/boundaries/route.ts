/**
 * GET /api/boundaries?geo= — geo-unit polygons as a GeoJSON FeatureCollection
 * (PRD §6 "aggregate boundaries", §7.1). The small (≤591 polygon) choropleth
 * geometry the scan map colors from /api/scan. The per-parcel high-zoom layer is
 * the PMTiles object on R2 (packages/tiles), not this route.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { isGeoType } from '../../../lib/scan-meta';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const geo = new URL(req.url).searchParams.get('geo') ?? 'neighborhood';
  if (!isGeoType(geo)) return NextResponse.json({ error: 'invalid geo' }, { status: 400 });

  const rows = await db()<{ geo_id: string; name: string | null; geom: string }[]>`
    select geo_id, name, ST_AsGeoJSON(geom) as geom
    from public.geo_boundary where geo_type = ${geo} and geom is not null
    order by geo_id`;

  const features = rows.map((r) => ({
    type: 'Feature' as const,
    properties: { geo_id: r.geo_id, geo_type: geo, name: r.name ?? r.geo_id },
    geometry: JSON.parse(r.geom),
  }));
  return NextResponse.json({ type: 'FeatureCollection', features });
}
