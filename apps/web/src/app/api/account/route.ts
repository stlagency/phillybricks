/**
 * GET /api/account — the signed-in user's profile + entitlement snapshot (M7).
 * Login-gated. Ensures the app.profile row exists (lazy bootstrap), then reports
 * attestation status and whether a BYO skip-trace key is on file. The key itself
 * is NEVER returned — only its presence + vendor (PRD §6).
 */
import { NextResponse } from 'next/server';
import type { AccountProfile, SkipTraceVendor } from '@bandbox/core/contracts';
import { db } from '../../../lib/db';
import { requireUser, ensureProfile, billingEnabled } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  await ensureProfile(user.userId, user.email);
  const sql = db();

  const prof = await sql<{ display_name: string | null; attested_skiptrace_at: Date | null }[]>`
    select display_name, attested_skiptrace_at
    from app.profile where id = ${user.userId} limit 1`;
  const key = await sql<{ vendor: string }[]>`
    select vendor from app.skiptrace_key where user_id = ${user.userId} limit 1`;
  const sub = await sql<{ status: string; current_period_end: Date | null }[]>`
    select status, current_period_end from app.subscription where user_id = ${user.userId} limit 1`;

  const body: AccountProfile = {
    user_id: user.userId,
    email: user.email,
    display_name: prof[0]?.display_name ?? null,
    attested_skiptrace_at: prof[0]?.attested_skiptrace_at
      ? prof[0].attested_skiptrace_at.toISOString()
      : null,
    has_skiptrace_key: key.length > 0,
    skiptrace_vendor: (key[0]?.vendor as SkipTraceVendor) ?? null,
    subscription_status: sub[0]
      ? sub[0].status === 'active'
        ? 'active'
        : sub[0].status === 'comped'
          ? 'comped'
          : 'inactive'
      : null,
    current_period_end: sub[0]?.current_period_end ? sub[0].current_period_end.toISOString() : null,
    billing_enabled: billingEnabled(),
  };
  return NextResponse.json(body);
}
