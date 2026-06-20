/**
 * POST /api/skiptrace/key — store the user's BYO vendor API key (M7, PRD §6).
 * The plaintext is encrypted into Supabase Vault server-side and only its Vault
 * secret id is recorded on app.skiptrace_key; the key is NEVER logged, never
 * returned, and never written to the encrypted_key column (which holds a sentinel).
 * DELETE removes the key + its Vault secret. Login-gated + CSRF-guarded.
 *
 * Vendor must be on the server allowlist (isKnownVendor) — the same enum that
 * selects the request host in the proxy, so a stored key can only ever target an
 * allowlisted vendor.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { requireUser, sameOrigin, authError } from '../../../../lib/auth';
import {
  isKnownVendor,
  setSkiptraceKey,
  deleteSkiptraceKey,
  type SqlLike,
} from '../../../../lib/skiptrace';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const b = body as { vendor?: unknown; api_key?: unknown };
  const vendor = typeof b.vendor === 'string' ? b.vendor : '';
  const apiKey = typeof b.api_key === 'string' ? b.api_key.trim() : '';

  if (!isKnownVendor(vendor)) return NextResponse.json({ error: 'unknown_vendor' }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: 'api_key required' }, { status: 400 });

  try {
    await setSkiptraceKey(db() as unknown as SqlLike, user.userId, vendor, apiKey);
  } catch {
    // Never echo the error (it could carry the key path/context). Generic 500.
    return NextResponse.json({ error: 'key_store_failed' }, { status: 500 });
  }
  return NextResponse.json({ stored: true, vendor });
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  await deleteSkiptraceKey(db() as unknown as SqlLike, user.userId);
  return NextResponse.json({ deleted: true });
}
