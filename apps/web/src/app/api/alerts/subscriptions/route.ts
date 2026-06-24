/**
 * /api/alerts/subscriptions — alert subscriptions over a saved area (PRD §3.5).
 * GET lists the user's subscriptions; POST creates one. Paid-gated (requirePaid: a subscription when the paywall is armed, else any signed-in user); POST is
 * CSRF-guarded. The target saved_area must belong to the user. Each subscription
 * gets an opaque unsub_token by default (DB) for the List-Unsubscribe link.
 */
import { NextResponse } from 'next/server';
import type {
  AlertSubscription,
  AlertTriggerType,
  CreateAlertSubscriptionInput,
} from '@bandbox/core/contracts';
import { db } from '../../../../lib/db';
import { requirePaid, sameOrigin, authError, ensureProfile } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_TRIGGERS: ReadonlySet<AlertTriggerType> = new Set<AlertTriggerType>([
  'new_transaction',
  'new_development',
  'new_distress',
  'new_matching_lead',
]);

interface SubRow {
  id: string;
  saved_area_id: string | null;
  trigger_types: string[] | null;
  channel: string;
  frequency: string;
  last_sent_at: Date | null;
  created_at: Date;
}

function toSub(r: SubRow): AlertSubscription {
  return {
    id: r.id,
    saved_area_id: r.saved_area_id,
    trigger_types: (r.trigger_types ?? []) as AlertTriggerType[],
    channel: r.channel === 'in_app' ? 'in_app' : 'email',
    frequency: 'daily',
    last_sent_at: r.last_sent_at ? r.last_sent_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

export async function GET(req: Request): Promise<Response> {
  const user = await requirePaid(req);
  if (user instanceof Response) return user;

  const rows = await db()<SubRow[]>`
    select id, saved_area_id, trigger_types, channel, frequency, last_sent_at, created_at
    from app.alert_subscription
    where user_id = ${user.userId}
    order by created_at desc`;
  return NextResponse.json(rows.map(toSub));
}

export async function POST(req: Request): Promise<Response> {
  const user = await requirePaid(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  let body: CreateAlertSubscriptionInput;
  try {
    body = (await req.json()) as CreateAlertSubscriptionInput;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const areaId = typeof body.saved_area_id === 'string' ? body.saved_area_id : '';
  if (!areaId) return NextResponse.json({ error: 'saved_area_id required' }, { status: 400 });

  // Only allowlisted, de-duplicated triggers; at least one.
  const triggers = [...new Set(Array.isArray(body.trigger_types) ? body.trigger_types : [])].filter(
    (t): t is AlertTriggerType => ALLOWED_TRIGGERS.has(t as AlertTriggerType),
  );
  if (triggers.length === 0) {
    return NextResponse.json({ error: 'at least one valid trigger_type required' }, { status: 400 });
  }
  const channel = body.channel === 'in_app' ? 'in_app' : 'email';

  // Capture the recipient email on app.profile so the nightly worker can address
  // the digest without auth.users access.
  await ensureProfile(user.userId, user.email);

  const sql = db();
  // The area must exist and belong to this user.
  const owns = await sql<{ one: number }[]>`
    select 1 as one from app.saved_area
    where id = ${areaId} and user_id = ${user.userId} limit 1`;
  if (owns.length === 0) return NextResponse.json({ error: 'area_not_found' }, { status: 404 });

  const rows = await sql<SubRow[]>`
    insert into app.alert_subscription (user_id, saved_area_id, trigger_types, channel, frequency)
    values (${user.userId}, ${areaId}, ${triggers}, ${channel}, 'daily')
    returning id, saved_area_id, trigger_types, channel, frequency, last_sent_at, created_at`;
  return NextResponse.json(toSub(rows[0]!));
}
