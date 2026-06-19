/**
 * Shared comps query (PRD §5.2): load the subject parcel + a candidate pool from
 * public.comp_candidate and run the core selectComps(). Used by /api/comps and
 * embedded in /api/parcel/:pk. Returns null when the parcel doesn't exist.
 */
import type { Sql } from 'postgres';
import { selectComps, type CompSubject, type CompCandidate, type CompsResult } from '@bandbox/core';
import { broadCategory } from './category';

const RADIUS_M = 3219; // ~2 miles

export async function computeComps(sql: Sql, pk: string): Promise<CompsResult | null> {
  const subj = await sql<
    {
      parcel_pk: string;
      lat: number | null;
      lon: number | null;
      neighborhood_id: string | null;
      beds: string | null;
      livable_area: string | null;
      year_built: number | null;
      category_code: string | null;
      market_value: string | null;
    }[]
  >`
    select parcel_pk, ST_Y(geom) as lat, ST_X(geom) as lon, neighborhood_id,
           beds::text, livable_area::text, year_built, category_code, market_value::text
    from public.parcel where parcel_pk = ${pk}`;
  if (subj.length === 0) return null;
  const s = subj[0]!;

  const subject: CompSubject = {
    parcel_pk: s.parcel_pk,
    lat: s.lat,
    lon: s.lon,
    neighborhood_id: s.neighborhood_id,
    beds: s.beds === null ? null : Number(s.beds),
    livable_area: s.livable_area === null ? null : Number(s.livable_area),
    year_built: s.year_built,
    category: broadCategory(s.category_code),
    market_value: s.market_value === null ? null : Number(s.market_value),
  };

  const hasGeom = s.lat !== null && s.lon !== null;
  const radiusClause = hasGeom
    ? sql`or ST_DWithin(cc.geom::geography, ST_SetSRID(ST_MakePoint(${s.lon}, ${s.lat}), 4326)::geography, ${RADIUS_M})`
    : sql``;
  const hoodClause = s.neighborhood_id ? sql`cc.neighborhood_id = ${s.neighborhood_id}` : sql`false`;

  const cand = await sql<
    {
      parcel_pk: string;
      address: string | null;
      sale_price: string;
      sale_date: string;
      lat: number | null;
      lon: number | null;
      neighborhood_id: string | null;
      beds: string | null;
      livable_area: string | null;
      year_built: number | null;
      category_code: string | null;
    }[]
  >`
    select cc.parcel_pk, cc.address, cc.sale_price::text, to_char(cc.sale_date,'YYYY-MM-DD') as sale_date,
           ST_Y(cc.geom) as lat, ST_X(cc.geom) as lon, cc.neighborhood_id,
           cc.beds::text, cc.livable_area::text, cc.year_built, cc.category_code
    from public.comp_candidate cc
    where cc.parcel_pk <> ${pk}
      and cc.sale_date >= (current_date - interval '48 months')
      and (${hoodClause} ${radiusClause})
    order by cc.sale_date desc, cc.transfer_id
    limit 3000`;

  const candidates: CompCandidate[] = cand.map((c) => ({
    parcel_pk: c.parcel_pk,
    address: c.address ?? '',
    sale_price: Number(c.sale_price),
    sale_date: c.sale_date,
    lat: c.lat,
    lon: c.lon,
    neighborhood_id: c.neighborhood_id,
    beds: c.beds === null ? null : Number(c.beds),
    livable_area: c.livable_area === null ? null : Number(c.livable_area),
    year_built: c.year_built,
    category: broadCategory(c.category_code),
    is_arms_length: true,
    source_stamp: `RTT · ${c.sale_date}`,
    source_url: '',
  }));

  return selectComps(subject, candidates);
}
