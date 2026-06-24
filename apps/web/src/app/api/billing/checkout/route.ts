/**
 * POST /api/billing/checkout — start a Stripe Checkout subscription (M8, PRD §7.5).
 * Login-gated + CSRF-guarded. Reuses (or creates) the user's Stripe customer, records
 * it on app.subscription, and returns a hosted Checkout URL the client redirects to.
 * Entitlement is granted by the verified webhook, never by the redirect (PRD §6).
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { requireUser, sameOrigin, authError } from '../../../../lib/auth';
import { stripe, stripeConfigured, priceId, type BillingInterval } from '../../../../lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'billing_unconfigured' }, { status: 503 });
  }

  // Interval: annual ($20/yr) is the default; monthly ($2/mo) is opt-in via body.
  let interval: BillingInterval = 'annual';
  try {
    const body = (await req.json().catch(() => ({}))) as { interval?: unknown };
    if (body.interval === 'monthly' || body.interval === 'annual') interval = body.interval;
  } catch {
    /* empty/invalid body → keep the annual default */
  }
  let price: string;
  try {
    price = priceId(interval);
  } catch {
    return NextResponse.json({ error: 'billing_unconfigured' }, { status: 503 });
  }

  const sql = db();
  const s = stripe();
  const origin = new URL(req.url).origin;

  // Reuse the user's Stripe customer, or create one and record it.
  const existing = await sql<{ stripe_customer_id: string | null }[]>`
    select stripe_customer_id from app.subscription where user_id = ${user.userId} limit 1`;
  let customerId = existing[0]?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await s.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.userId },
    });
    customerId = customer.id;
    await sql`
      insert into app.subscription (user_id, stripe_customer_id, status)
      values (${user.userId}, ${customerId}, 'inactive')
      on conflict (user_id) do update
        set stripe_customer_id = excluded.stripe_customer_id, updated_at = now()`;
  }

  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.userId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/account?billing=success`,
    cancel_url: `${origin}/account?billing=cancel`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
