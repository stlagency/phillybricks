/**
 * /api/areas — saved areas ("farms", PRD §3.5). GET lists the user's areas; POST
 * creates one in any of three modes, building a MultiPolygon geom server-side:
 *   polygon   → a GeoJSON Polygon (validated + ST_MakeValid'd).
 *   canonical → a geo_boundary's geometry (geo_type + geo_id; must exist).
 *   radius    → an ST_Buffer circle around a lon/lat (meters, capped at 50 km).
 *
 * Login-gated; POST is CSRF-guarded. Ownership is enforced in SQL (user_id bound)
 * because the server connection is not the `authenticated` role (RLS-exempt).
 */
import { NextResponse } from 'next/server';
import type { SavedArea, SaveAreaInput, SavedAreaKind } from '@bandbox/core/contracts';
import { db } from '../../../lib/db';
import { requireUser, sameOrigin, authError } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

interface SavedAreaRow {
  id: string;
  name: string | null;
  kind: string;
  created_at: Date;
}

function toArea(r: SavedAreaRow): SavedArea {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as SavedAreaKind,
    created_at: r.created_at.toISOString(),
  };
}

export async function GET(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const rows = await db()<SavedAreaRow[]>`
    select id, name, kind, created_at from app.saved_area
    where user_id = ${user.userId}
    order by created_at desc`;
  return NextResponse.json(rows.map(toArea));
}

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  let body: SaveAreaInput;
  try {
    body = (await req.json()) as SaveAreaInput;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const sql = db();

  // Build the MultiPolygon geom fragment for the requested mode.
  let geomSql;
  if (body.kind === 'polygon') {
    if (!body.geojson) return NextResponse.json({ error: 'geojson required' }, { status: 400 });
    const gj = JSON.stringify(body.geojson);
    geomSql = sql`st_multi(st_makevalid(st_setsrid(st_geomfromgeojson(${gj}), 4326)))`;
  } else if (body.kind === 'canonical') {
    if (!body.geo_type || !body.geo_id) {
      return NextResponse.json({ error: 'geo_type + geo_id required' }, { status: 400 });
    }
    // The boundary must exist (else we'd store a NULL-geom area, useless for alerts).
    const exists = await sql<{ one: number }[]>`
      select 1 as one from public.geo_boundary
      where geo_type = ${body.geo_type} and geo_id = ${body.geo_id} limit 1`;
    if (exists.length === 0) return NextResponse.json({ error: 'boundary_not_found' }, { status: 404 });
    geomSql = sql`(select st_multi(geom) from public.geo_boundary
      where geo_type = ${body.geo_type} and geo_id = ${body.geo_id} limit 1)`;
  } else if (body.kind === 'radius') {
    const c = body.center;
    const r = body.radius_m;
    if (
      !c ||
      typeof c.lon !== 'number' ||
      typeof c.lat !== 'number' ||
      typeof r !== 'number' ||
      !(r > 0 && r <= 50_000)
    ) {
      return NextResponse.json(
        { error: 'center {lon,lat} + radius_m (0–50000) required' },
        { status: 400 },
      );
    }
    geomSql = sql`st_multi(st_buffer(
      st_setsrid(st_makepoint(${c.lon}, ${c.lat}), 4326)::geography, ${r})::geometry)`;
  } else {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }

  let rows: SavedAreaRow[];
  try {
    rows = await sql<SavedAreaRow[]>`
      insert into app.saved_area (user_id, name, kind, geom)
      values (${user.userId}, ${name}, ${body.kind}, ${geomSql})
      returning id, name, kind, created_at`;
  } catch {
    // Bad GeoJSON / non-polygon geometry → the typed column rejects it.
    return NextResponse.json({ error: 'invalid_geometry' }, { status: 400 });
  }

  return NextResponse.json(toArea(rows[0]!));
}
