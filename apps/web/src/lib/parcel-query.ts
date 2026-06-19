/**
 * Assemble the frozen ParcelDeepDive (PRD §6, §7.2) for one parcel from the
 * canonical + derived tables. Extracted from the /api/parcel/[pk] route so the
 * server-rendered deep-dive PAGE can call it directly (no HTTP hop) and the route
 * stays a thin wrapper — single source of truth for the bundle shape.
 *
 * Returns null when the parcel does not exist (route → 404, page → notFound()).
 */
import type { Sql } from 'postgres';
import type {
  ParcelDeepDive,
  ParcelCore,
  TransferRow,
  LiRow,
  TaxStatus,
  NearbyCounts,
} from '@bandbox/core/contracts';
import { distressFromRow } from './distress-row';
import { computeComps } from './comps-query';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
// postgres.js returns DATE columns as JS Date objects; the page calls this
// directly (no JSON round-trip to stringify them), so coerce to 'YYYY-MM-DD'.
const dateStr = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

/**
 * Deep links into Philadelphia's two canonical public-record front-ends, so every
 * Sourced<T> on the page can point back at the raw record (no black box, PRD §6).
 * `opaUrl` → property.phila.gov (the assessor's parcel page: assessment + tax).
 * `atlasUrl` → atlas.phila.gov (the city's parcel atlas: deeds, L&I, zoning).
 */
export const opaUrl = (pk: string): string => `https://property.phila.gov/?p=${pk}`;
export const atlasUrl = (address: string): string => `https://atlas.phila.gov/${encodeURIComponent(address)}`;

export async function loadDeepDive(sql: Sql, pk: string): Promise<ParcelDeepDive | null> {
  const prow = await sql<(Record<string, unknown> & { parcel_pk: string })[]>`
    select p.*, ST_Y(p.geom) as lat, ST_X(p.geom) as lon, gb.name as neighborhood_name
    from public.parcel p
    left join public.geo_boundary gb
      on gb.geo_type = 'neighborhood' and gb.geo_id = p.neighborhood_id
    where p.parcel_pk = ${pk}`;
  if (prow.length === 0) return null;
  const p = prow[0]!;

  const parcel: ParcelCore = {
    parcel_pk: String(p.parcel_pk),
    pin: (p.pin as string | null) ?? null,
    address: (p.address as string | null) ?? '',
    zip: (p.zip as string | null) ?? null,
    lat: num(p.lat),
    lon: num(p.lon),
    market_value: num(p.market_value),
    sale_price: num(p.sale_price),
    sale_date: dateStr(p.sale_date),
    year_built: num(p.year_built),
    beds: num(p.beds),
    livable_area: num(p.livable_area),
    category_code: (p.category_code as string | null) ?? null,
    zoning: (p.zoning as string | null) ?? null,
    owner_1: (p.owner_1 as string | null) ?? null,
    owner_2: (p.owner_2 as string | null) ?? null,
    mailing_address: (p.mailing_address as string | null) ?? null,
    is_out_of_state_owner: Boolean(p.is_out_of_state_owner),
    neighborhood_id: (p.neighborhood_id as string | null) ?? null,
    neighborhood_name: (p.neighborhood_name as string | null) ?? null,
    zip_id: (p.zip_id as string | null) ?? null,
    tract_id: (p.tract_id as string | null) ?? null,
  };

  const [transfersRaw, liRaw, taxDel, taxBal, distressRow, nearbyCrime, nearby311, comps] =
    await Promise.all([
      sql<Record<string, unknown>[]>`
        select transfer_id, document_type, to_char(recording_date,'YYYY-MM-DD') as recording_date,
               total_consideration::text as total_consideration, is_sheriff, is_distress_doc,
               is_estate_or_nonmarket, is_arms_length, price_to_assessment::text as price_to_assessment
        from public.transfer where parcel_pk = ${pk}
        order by recording_date desc nulls last limit 60`,
      sql<Record<string, unknown>[]>`
        (select 'permit' as kind, permit_type as type_code, status, to_char(permit_issued_date,'YYYY-MM-DD') as date from public.permit where parcel_pk = ${pk} order by permit_issued_date desc nulls last limit 250)
        union all
        (select 'violation', violation_type, status, to_char(violation_date,'YYYY-MM-DD') from public.violation where parcel_pk = ${pk} order by violation_date desc nulls last limit 250)
        union all
        (select 'complaint', complaint_type, status, to_char(complaint_date,'YYYY-MM-DD') from public.complaint where parcel_pk = ${pk} order by complaint_date desc nulls last limit 250)
        union all
        (select 'case_investigation', case_type, status, to_char(investigation_date,'YYYY-MM-DD') from public.case_investigation where parcel_pk = ${pk} order by investigation_date desc nulls last limit 250)`,
      sql<Record<string, unknown>[]>`
        select total_due::text as total_due, is_actionable, sheriff_sale, year_month
        from public.tax_delinquency where parcel_pk = ${pk}
        order by year_month desc nulls last limit 1`,
      sql<{ total: string | null }[]>`
        select sum(total)::text as total from public.tax_balance where parcel_pk = ${pk}`,
      sql<(Record<string, unknown> & { parcel_pk: string })[]>`
        select * from public.distress_signal where parcel_pk = ${pk}`,
      sql<{ month: string; n: string }[]>`
        select to_char(occurred_on,'YYYY-MM') as month, count(*)::text as n
        from public.crime_incident
        where neighborhood_id = ${parcel.neighborhood_id}
          and occurred_on >= (current_date - interval '12 months')
        group by 1 order by 1`,
      sql<{ month: string; n: string }[]>`
        select to_char(occurred_on,'YYYY-MM') as month, count(*)::text as n
        from public.service_request
        where neighborhood_id = ${parcel.neighborhood_id}
          and occurred_on >= (current_date - interval '12 months')
        group by 1 order by 1`,
      computeComps(sql, pk),
    ]);

  const transfers: TransferRow[] = transfersRaw.map((t) => ({
    transfer_id: String(t.transfer_id),
    document_type: (t.document_type as string | null) ?? '',
    recording_date: (t.recording_date as string | null) ?? '',
    total_consideration: num(t.total_consideration),
    is_sheriff: Boolean(t.is_sheriff),
    is_distress_doc: Boolean(t.is_distress_doc),
    is_estate_or_nonmarket: Boolean(t.is_estate_or_nonmarket),
    is_arms_length: Boolean(t.is_arms_length),
    price_to_assessment: num(t.price_to_assessment),
    source_stamp: `RTT · ${(t.recording_date as string | null) ?? ''}`,
  }));

  const li: LiRow[] = liRaw.map((r) => ({
    kind: r.kind as LiRow['kind'],
    type_code: (r.type_code as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    date: (r.date as string | null) ?? null,
    source_stamp: `L&I · ${(r.date as string | null) ?? ''}`,
  }));

  const del = taxDel[0];
  const delDue = del ? num(del.total_due) : null;
  // Assessment + tax figures live on the OPA parcel page; deeds/L&I live on Atlas.
  const opaHref = opaUrl(parcel.parcel_pk);
  const stamp = (
    s: string,
    url: string,
  ): { source_stamp: string; source_url: string; refreshed_at: string | null } => ({
    source_stamp: s,
    source_url: url,
    refreshed_at: null,
  });
  const tax: TaxStatus = {
    billed: { value: null, ...stamp('OPA', opaHref) },
    status: delDue && delDue > 0 ? 'delinquent' : del ? 'current' : 'unknown',
    balance_with_penalty: { value: delDue ?? num(taxBal[0]?.total ?? null), ...stamp('Revenue · delinquency', opaHref) },
    sheriff_sale_flag: Boolean(del?.sheriff_sale),
  };

  const trendOf = (rows: { month: string; n: string }[]): number[] => rows.map((r) => Number(r.n));
  const nearby: NearbyCounts = {
    crime: {
      window_label: 'last 12 months (neighborhood)',
      count: nearbyCrime.reduce((acc, r) => acc + Number(r.n), 0),
      trend: trendOf(nearbyCrime),
    },
    service_requests: {
      window_label: 'last 12 months (neighborhood)',
      count: nearby311.reduce((acc, r) => acc + Number(r.n), 0),
      trend: trendOf(nearby311),
    },
  };

  const mv = parcel.market_value;
  const la = parcel.livable_area;
  const lastSale = parcel.sale_price;
  const assessment_vs_sale: ParcelDeepDive['assessment_vs_sale'] = {
    market_value: { value: mv, ...stamp('OPA assessment', opaHref) },
    last_sale: { value: lastSale, ...stamp(`OPA last sale · ${parcel.sale_date ?? ''}`, opaHref) },
    assessed_psf: { value: mv && la && la > 0 ? Math.round((mv / la) * 100) / 100 : null, ...stamp('OPA', opaHref) },
    // Only meaningful against a real (non-nominal) last sale; a $1 estate/quitclaim
    // deed would otherwise yield an absurd percentage.
    change_since_sale_pct:
      mv && lastSale && lastSale > 1000 ? Math.round(((mv - lastSale) / lastSale) * 1000) / 10 : null,
  };

  const distress = distressRow.length > 0 ? distressFromRow(distressRow[0]!) : distressFromRow({ parcel_pk: pk });

  // comps is non-null when the parcel exists (computeComps re-queries it); guard anyway.
  if (comps === null) return null;

  return { parcel, assessment_vs_sale, transfers, li, tax, nearby, comps, distress };
}
