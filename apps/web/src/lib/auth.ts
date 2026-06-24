/**
 * Auth seam for the login-gated surfaces (PRD §6, §7.5). The gated routes
 * (CSV export, mini-CRM writes, BYO skip-trace) all call THESE helpers, so wiring
 * real Supabase Auth in M7 is a one-file change — nothing else moves.
 *
 * Monetization is DEFERRED to M8: those surfaces are free for any authenticated
 * user (`requireUser`), and the subscription machinery (`hasActiveSubscription`/
 * `requireEntitlement`, `app.subscription`, the Stripe dep) stays in place but
 * UNENFORCED — a dormant seam re-armed in M8 by flipping the two call sites back.
 *
 * M7 WIRED: `getUserId()` resolves a real Supabase user from the request's
 * `Authorization: Bearer <access_token>` header — validated by GoTrue via
 * `auth.getUser(jwt)` (signature + expiry checked server-side). The browser holds
 * the session and attaches the token on every gated fetch (lib/api-client). With no
 * valid token the gated routes return 401, so the seam fails closed.
 *
 *   BANDBOX_DEV_USER_ID — local-only override (treat every request as this user).
 *   Hardened in M7: honored ONLY when NODE_ENV !== 'production', so even if the var
 *   leaked into a prod environment it could never bypass real auth.
 */
import { db } from './db';
import { supabaseAuthClient } from './supabase-server';

export interface SessionUser {
  userId: string;
  /** Email from the validated session, when available (null under the dev seam). */
  email: string | null;
}

/** A JSON error Response with the right status (the gated-route refusal shape). */
export function authError(status: 401 | 403, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Extract a Bearer access token from the Authorization header, or null. */
function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * Resolve the current session (user id + email), or null if unauthenticated (M7).
 * Validates the request's Bearer access token against Supabase Auth (`auth.getUser`
 * — GoTrue checks the JWT signature + expiry). Fails closed: any missing/invalid
 * token, or unconfigured Supabase env, yields null → 401 at the gate.
 */
export async function getSession(req: Request): Promise<SessionUser | null> {
  // Local-only dev override — NEVER honored in production, even if the var leaks.
  if (process.env.NODE_ENV !== 'production' && process.env.BANDBOX_DEV_USER_ID) {
    return { userId: process.env.BANDBOX_DEV_USER_ID, email: null };
  }

  const token = bearerToken(req);
  if (!token) return null;

  const supa = supabaseAuthClient();
  if (!supa) return null;

  try {
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? null };
  } catch {
    return null; // network/transient → treat as unauthenticated (fail closed)
  }
}

/** Resolve just the current user id, or null if unauthenticated (M7). */
export async function getUserId(req: Request): Promise<string | null> {
  return (await getSession(req))?.userId ?? null;
}

/**
 * Idempotently ensure the user's app.profile row exists (id = user_id = auth uid),
 * capturing the session email when known. Called by the surfaces that need a profile
 * (account, attestation, alert subscriptions) so we don't depend on an auth.users
 * trigger that the CI gate's bare PostGIS lacks — and so the nightly alert worker can
 * read the recipient from app.profile without auth.users access. RLS-exempt server
 * connection.
 */
export async function ensureProfile(userId: string, email?: string | null): Promise<void> {
  if (email) {
    await db()`
      insert into app.profile (id, user_id, email) values (${userId}, ${userId}, ${email})
      on conflict (id) do update set email = excluded.email`;
  } else {
    await db()`
      insert into app.profile (id, user_id) values (${userId}, ${userId})
      on conflict (id) do nothing`;
  }
}

/** 401 unless authenticated; otherwise the SessionUser (id + email). */
export async function requireUser(req: Request): Promise<SessionUser | Response> {
  const session = await getSession(req);
  if (!session) return authError(401, 'auth_required');
  return session;
}

/**
 * Entitlement check (the paid gate, PRD §7.5). Server connection reads
 * app.subscription directly (it is not the `authenticated` role, so the check is
 * explicit, not RLS-implicit). Entitled = a paid Stripe subscription ('active',
 * written by the verified webhook) OR an admin-granted comp ('comped', written by
 * the admin-comp route). Both unlock the paid surfaces.
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const rows = await db()<{ one: number }[]>`
    select 1 as one from app.subscription
    where user_id = ${userId} and status in ('active', 'comped') limit 1`;
  return rows.length > 0;
}

/** 401 if unauthenticated, 403 if not subscribed; otherwise the SessionUser. */
export async function requireEntitlement(req: Request): Promise<SessionUser | Response> {
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  if (!(await hasActiveSubscription(u.userId))) return authError(403, 'subscription_required');
  return u;
}

/** True when the paywall is armed (BILLING_ENABLED=true). When false, the paid
 *  surfaces are free for any authenticated user (M8 monetization is reversible by
 *  config — no redeploy to turn billing on or off). */
export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true';
}

/**
 * The paid gate (M8): requires an active subscription when billing is armed,
 * otherwise just an authenticated user. The two paid surfaces (CSV export,
 * skip-trace) call this instead of requireUser/requireEntitlement directly, so the
 * paywall flips on/off with BILLING_ENABLED alone.
 */
export async function requirePaid(req: Request): Promise<SessionUser | Response> {
  return billingEnabled() ? requireEntitlement(req) : requireUser(req);
}

/**
 * Is this email an owner/admin? Membership is an env allowlist (ADMIN_EMAILS, a
 * comma-separated list), matched case-insensitively. Unset/empty ⇒ nobody is admin
 * (fail closed). The only privileged operation today is comping a user to free.
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return false;
  const target = email.trim().toLowerCase();
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}

/** 401 if unauthenticated, 403 if not an admin; otherwise the SessionUser. */
export async function requireAdmin(req: Request): Promise<SessionUser | Response> {
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  if (!isAdmin(u.email)) return authError(403, 'forbidden');
  return u;
}

/** Has the user signed the per-user lawful-use attestation (PRD §8)? Required
 *  before any skip-trace call. */
export async function hasSkiptraceAttestation(userId: string): Promise<boolean> {
  const rows = await db()<{ at: Date | null }[]>`
    select attested_skiptrace_at as at from app.profile where id = ${userId} limit 1`;
  return rows.length > 0 && rows[0]!.at != null;
}

/**
 * Same-origin / CSRF guard for state-changing POSTs (PRD §6). A cross-site form
 * post carries a foreign Origin; reject it. Same-origin server fetches may omit
 * Origin entirely — those are allowed (there is no cross-origin attacker vector
 * without an Origin header in a browser).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
