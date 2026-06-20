/**
 * POST /api/skiptrace/:pk — BYO skip-trace proxy (PRD §6 threat model, §7.5, §8).
 * The server connection IS the privileged proxy context: it is the ONLY place the
 * user's stored vendor key is read and decrypted, and the lookup is forwarded to a
 * vendor chosen from the server allowlist (lib/skiptrace) — never a host from the
 * DB or request. The decrypted key and the returned PII are NEVER logged.
 *
 * Guard order (fail closed, cheapest/most-general first):
 *   1. sameOrigin  → 403 (CSRF: reject foreign-Origin posts)
 *   2. requireUser → its 401 (login-gated; free for authenticated users, the paid
 *      gate is deferred to M8 — the requireEntitlement seam stays dormant)
 *   3. hasSkiptraceAttestation → 403 attestation_required (per-user lawful-use, §8)
 *   4. stored key present → 403 no_skiptrace_key
 *   5. runSkipTrace, mapping typed errors: RateLimitError→429, UnknownVendorError→400,
 *      VendorError→502.
 *
 * The per-user daily cap uses a module-level in-memory store (see lib/skiptrace —
 * M7 makes it a shared/DB store for a true global cap across serverless instances).
 */
import { NextResponse } from 'next/server';
import type { SkipTraceVendor } from '@bandbox/core/contracts';
import { db } from '../../../../lib/db';
import {
  authError,
  requireUser,
  hasSkiptraceAttestation,
  sameOrigin,
} from '../../../../lib/auth';
import {
  runSkipTrace,
  getSkiptraceKey,
  createDbUsageStore,
  RateLimitError,
  UnknownVendorError,
  VendorError,
  type SkipTraceParcel,
  type SqlLike,
} from '../../../../lib/skiptrace';

export const dynamic = 'force-dynamic';

/** Per-user daily cap (M7): GLOBAL, DB-backed (app.skiptrace_usage) so it holds
 *  across serverless instances — unlike the old per-instance in-memory counter. */
const DAILY_CAP = 50;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ pk: string }> },
): Promise<Response> {
  // 1. CSRF: reject cross-origin posts.
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  // 2. require an authenticated user (monetization deferred to M8).
  const authed = await requireUser(req);
  if (authed instanceof Response) return authed;
  const { userId } = authed;

  // 3. per-user lawful-use attestation (PRD §8).
  if (!(await hasSkiptraceAttestation(userId))) return authError(403, 'attestation_required');

  const { pk } = await ctx.params;
  const sql = db();
  // The skiptrace helpers take a structural SqlLike (so that module imports no DB
  // client); a concrete postgres Sql satisfies it — cast as the codebase does for
  // its DbClient seam.
  const sqlClient = sql as unknown as SqlLike;
  const usageStore = createDbUsageStore(sqlClient, DAILY_CAP);

  // 4. the user's stored vendor key — resolved via the SECURITY DEFINER proxy
  //    (the ONLY decrypt of the key; the worker role has no direct Vault access).
  const resolved = await getSkiptraceKey(sqlClient, userId);
  if (!resolved) return authError(403, 'no_skiptrace_key');
  const vendor = resolved.vendor as SkipTraceVendor;
  const apiKey = resolved.apiKey;

  // Load the parcel projection the vendor request needs.
  const parcelRows = await sql<
    {
      parcel_pk: string;
      address: string | null;
      owner_1: string | null;
      owner_2: string | null;
      mailing_address: string | null;
    }[]
  >`
    select parcel_pk, address, owner_1, owner_2, mailing_address
    from public.parcel where parcel_pk = ${pk} limit 1`;
  if (parcelRows.length === 0) return NextResponse.json({ error: 'parcel not found' }, { status: 404 });
  const parcel: SkipTraceParcel = parcelRows[0]!;

  // 5. forward the lookup; map typed errors → status codes. NEVER log key or PII.
  try {
    const result = await runSkipTrace({ userId, vendor, apiKey, parcel, store: usageStore });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: 'rate_limited', remaining: err.remaining }, { status: 429 });
    }
    if (err instanceof UnknownVendorError) {
      return NextResponse.json({ error: 'unknown_vendor' }, { status: 400 });
    }
    if (err instanceof VendorError) {
      return NextResponse.json({ error: 'vendor_error' }, { status: 502 });
    }
    // Unknown failure — surface a generic 500 without echoing the cause (no key leak).
    return NextResponse.json({ error: 'skiptrace_failed' }, { status: 500 });
  }
}
