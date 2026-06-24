/**
 * POST /api/admin/comp — owner-only "comp a user to free" (M8 billing revision).
 * Admin-gated (ADMIN_EMAILS allowlist) + CSRF-guarded. Grants or revokes an
 * entitlement WITHOUT Stripe by writing app.subscription.status:
 *   action 'grant'  → status='comped' (+ comped_by/comped_at audit) — unlocks paid gates.
 *   action 'revoke' → status='inactive' (+ clear comp audit), ONLY if currently 'comped'
 *                     (never clobbers a real paid 'active' Stripe subscription).
 *
 * Target the user by `email` (resolved via app.profile — they must have signed in at
 * least once) or directly by `user_id`. Writes use the RLS-exempt server connection,
 * the same privileged path as the verified Stripe webhook (no anon/authenticated grant).
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { requireAdmin, sameOrigin, authError } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

interface CompInput {
  email?: unknown;
  user_id?: unknown;
  action?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  let body: CompInput;
  try {
    body = (await req.json()) as CompInput;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const action = body.action === 'revoke' ? 'revoke' : 'grant';
  const sql = db();

  // Resolve the target user_id: explicit user_id wins, else look up by profile email.
  let targetId: string | null = typeof body.user_id === 'string' ? body.user_id.trim() : null;
  if (!targetId) {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email) return NextResponse.json({ error: 'email_or_user_id_required' }, { status: 400 });
    const rows = await sql<{ id: string }[]>`
      select id from app.profile where lower(email) = lower(${email}) limit 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
    targetId = rows[0]!.id;
  }

  if (action === 'grant') {
    await sql`
      insert into app.subscription (user_id, status, comped_by, comped_at, updated_at)
      values (${targetId}, 'comped', ${admin.userId}, now(), now())
      on conflict (user_id) do update set
        status = 'comped', comped_by = ${admin.userId}, comped_at = now(), updated_at = now()`;
    return NextResponse.json({ user_id: targetId, status: 'comped' });
  }

  // revoke: only undo a comp — leave a real paid 'active' subscription untouched.
  const updated = await sql<{ status: string }[]>`
    update app.subscription
       set status = 'inactive', comped_by = null, comped_at = null, updated_at = now()
     where user_id = ${targetId} and status = 'comped'
     returning status`;
  return NextResponse.json({
    user_id: targetId,
    status: updated.length > 0 ? 'inactive' : 'unchanged',
  });
}
