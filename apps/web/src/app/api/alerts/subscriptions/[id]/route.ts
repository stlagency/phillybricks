/**
 * DELETE /api/alerts/subscriptions/:id — remove an alert subscription for the
 * current user. Paid-gated (requirePaid: a subscription when the paywall is armed, else any signed-in user) + CSRF-guarded; ownership enforced in SQL.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { requirePaid, sameOrigin, authError } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requirePaid(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  const { id } = await ctx.params;
  const rows = await db()<{ id: string }[]>`
    delete from app.alert_subscription
    where id = ${id} and user_id = ${user.userId}
    returning id`;
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
