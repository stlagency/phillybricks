/**
 * DELETE /api/areas/:id — remove a saved area (and any alert subscriptions on it)
 * for the current user. Login-gated + CSRF-guarded; ownership enforced in SQL.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { requireUser, sameOrigin, authError } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  const { id } = await ctx.params;
  const sql = db();

  // Drop subscriptions that target this area first (keeps the alert feed coherent).
  await sql`
    delete from app.alert_subscription
    where saved_area_id = ${id} and user_id = ${user.userId}`;
  const rows = await sql<{ id: string }[]>`
    delete from app.saved_area
    where id = ${id} and user_id = ${user.userId}
    returning id`;

  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
