/**
 * /api/alerts — the in-app alert feed (PRD §3.5). GET lists the user's alert
 * events (newest first; `?unread=1` filters to unread). PATCH marks events read:
 * body `{ all: true }` marks everything, or `{ ids: [...] }` marks those rows.
 * Paid-gated (requirePaid: a subscription when the paywall is armed, else any signed-in user); PATCH is CSRF-guarded. Ownership enforced in SQL.
 */
import { NextResponse } from 'next/server';
import type { AlertEvent, AlertTriggerType } from '@bandbox/core/contracts';
import { db } from '../../../lib/db';
import { requirePaid, sameOrigin, authError } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const FEED_LIMIT = 200;

interface EventRow {
  id: string;
  parcel_pk: string | null;
  trigger_type: string;
  payload: Record<string, unknown> | null;
  created_at: Date;
  read_at: Date | null;
}

function toEvent(r: EventRow): AlertEvent {
  return {
    id: r.id,
    parcel_pk: r.parcel_pk,
    trigger_type: r.trigger_type as AlertTriggerType,
    payload: r.payload ?? {},
    created_at: r.created_at.toISOString(),
    read_at: r.read_at ? r.read_at.toISOString() : null,
  };
}

export async function GET(req: Request): Promise<Response> {
  const user = await requirePaid(req);
  if (user instanceof Response) return user;

  const unread = new URL(req.url).searchParams.get('unread') === '1';
  const sql = db();
  const rows = unread
    ? await sql<EventRow[]>`
        select id, parcel_pk, trigger_type, payload, created_at, read_at
        from app.alert_event
        where user_id = ${user.userId} and read_at is null
        order by created_at desc limit ${FEED_LIMIT}`
    : await sql<EventRow[]>`
        select id, parcel_pk, trigger_type, payload, created_at, read_at
        from app.alert_event
        where user_id = ${user.userId}
        order by created_at desc limit ${FEED_LIMIT}`;
  return NextResponse.json(rows.map(toEvent));
}

export async function PATCH(req: Request): Promise<Response> {
  const user = await requirePaid(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const b = body as { all?: unknown; ids?: unknown };
  const sql = db();

  if (b.all === true) {
    await sql`
      update app.alert_event set read_at = now()
      where user_id = ${user.userId} and read_at is null`;
    return NextResponse.json({ ok: true });
  }

  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ error: 'ids or all required' }, { status: 400 });
  await sql`
    update app.alert_event set read_at = now()
    where user_id = ${user.userId} and id in ${sql(ids)}`;
  return NextResponse.json({ ok: true });
}
