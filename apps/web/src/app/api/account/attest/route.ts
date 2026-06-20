/**
 * POST /api/account/attest — record the per-user lawful-use skip-trace attestation
 * (PRD §8): sets app.profile.attested_skiptrace_at = now(). DELETE revokes it.
 * Login-gated + CSRF-guarded. The skip-trace proxy refuses (403 attestation_required)
 * until this is set.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { requireUser, ensureProfile, sameOrigin, authError } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  await ensureProfile(user.userId, user.email);
  await db()`update app.profile set attested_skiptrace_at = now() where id = ${user.userId}`;
  return NextResponse.json({ attested: true });
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  await ensureProfile(user.userId, user.email);
  await db()`update app.profile set attested_skiptrace_at = null where id = ${user.userId}`;
  return NextResponse.json({ attested: false });
}
