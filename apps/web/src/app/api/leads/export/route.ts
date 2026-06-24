/**
 * GET /api/leads/export — server-streamed CSV of the current filtered leads set
 * (PRD §7.3, §6). PAID-GATED: requirePaid() first; a 401/403 refusal Response is
 * returned verbatim. Requires a subscription (active or comped) when the paywall is
 * armed (BILLING_ENABLED), else free for any signed-in user.
 *
 * The set is the SAME filter the list/facets use (lib/leads-query buildLeadsWhere),
 * streamed over a postgres.js cursor and serialized row-by-row through the pure
 * RFC-4180 serializer (lib/leads-csv) into a ReadableStream — so a 25k-row export
 * never buffers in memory. Row cap = 25_000; when the set is larger the response
 * carries `X-Row-Cap: 25000` (the body is the first 25k by score desc).
 *
 * Columns (EXACTLY, in order):
 *   parcel_pk, address, owner_1, mailing_address,
 *   <one column per distress component, the component label, value 0–100 = its
 *    contribution ×100 via lib/distress-row distressFromRow>,
 *   distress_composite (score100),
 *   key_signals (semicolon-joined active boolean signal flags).
 *
 * NO phones, emails, or any skip-trace contact data — that is session-only and
 * never written to disk (PRD §6 threat model). owner_1 + mailing_address are the
 * public OPA columns only.
 */
import { DISTRESS_CONFIG, DISTRESS_COMPONENT_KEYS } from '@bandbox/core';
import type { DistressComponentKey } from '@bandbox/core/contracts';
import { db } from '../../../../lib/db';
import { requirePaid } from '../../../../lib/auth';
import { distressFromRow } from '../../../../lib/distress-row';
import { parseLeadsFilter, buildLeadsWhere, type LeadsQueryRow } from '../../../../lib/leads-query';
import { csvRow } from '../../../../lib/leads-csv';

export const dynamic = 'force-dynamic';

const ROW_CAP = 25_000;

/** The boolean signal flags reported in `key_signals` (matview boolean columns). */
const KEY_SIGNAL_FLAGS: DistressComponentKey[] = [
  'actionable_sheriff_flag',
  'unsafe_or_imm_dang',
  'on_sheriff_list',
  'out_of_state_owner',
  'vacancy_proxy',
];

export async function GET(req: Request): Promise<Response> {
  const gate = await requirePaid(req);
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const sql = db();
  const filter = parseLeadsFilter(url.searchParams);
  const where = buildLeadsWhere(sql, filter);

  // Header: fixed identity columns, then one per distress component (in config
  // order, label-keyed), then the composite and the active-signal summary.
  const componentLabels = DISTRESS_COMPONENT_KEYS.map(
    (k) => DISTRESS_CONFIG.components[k].label,
  );
  const header = [
    'parcel_pk',
    'address',
    'owner_1',
    'mailing_address',
    ...componentLabels,
    'distress_composite',
    'key_signals',
  ];

  // Pre-resolve whether each capped row was actually emitted, so we can stamp
  // X-Row-Cap only when the underlying set exceeds the cap (one cheap probe).
  const probe = await sql<{ n: string }[]>`
    select count(*)::text as n from (
      select 1
      from public.distress_signal ds
      join public.parcel p on p.parcel_pk = ds.parcel_pk
      where ${where}
      limit ${ROW_CAP + 1}
    ) t`;
  const truncated = Number(probe[0]?.n ?? '0') > ROW_CAP;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvRow(header) + '\r\n'));

        const cursor = sql<LeadsExportRow[]>`
          select
            ds.*,
            p.address,
            p.owner_1,
            p.mailing_address
          from public.distress_signal ds
          join public.parcel p on p.parcel_pk = ds.parcel_pk
          where ${where}
          order by ds.score01 desc, ds.parcel_pk
          limit ${ROW_CAP}`.cursor(500);

        for await (const batch of cursor) {
          for (const row of batch) {
            controller.enqueue(encoder.encode(csvRow(toCells(row)) + '\r\n'));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const headers: Record<string, string> = {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="leads-export.csv"',
    'cache-control': 'no-store',
  };
  if (truncated) headers['x-row-cap'] = String(ROW_CAP);

  return new Response(stream, { headers });
}

/** Matview row + the three parcel columns the export needs. */
type LeadsExportRow = LeadsQueryRow & { mailing_address: string | null };

/** One export row → ordered cells matching the header (contributions ×100). */
function toCells(row: LeadsExportRow): (string | number | null)[] {
  const result = distressFromRow(row);
  // Map component key → contribution (0–100), defaulting to 0 for absent comps.
  const byKey = new Map<string, number>();
  for (const c of result.components) byKey.set(c.component, Math.round(c.contribution * 100));
  const componentCells = DISTRESS_COMPONENT_KEYS.map((k) => byKey.get(k) ?? 0);

  // key_signals: active boolean flags, joined with ';' (empty if none active).
  const active = KEY_SIGNAL_FLAGS.filter((k) => Boolean(row[k]));

  return [
    String(row.parcel_pk),
    (row.address as string | null) ?? '',
    (row.owner_1 as string | null) ?? '',
    (row.mailing_address as string | null) ?? '',
    ...componentCells,
    result.score100,
    active.join(';'),
  ];
}
