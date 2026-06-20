/**
 * POST /api/billing/portal — open the Stripe Customer Portal (M8). Login-gated +
 * CSRF-guarded. The portal is where the user updates their card, views invoices, and
 * cancels — all Stripe-hosted, no UI to build. 404 if the user has no Stripe customer.
 */
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { requireUser, sameOrigin, authError } from '../../../../lib/auth';
import { stripe, stripeConfigured } from '../../../../lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'billing_unconfigured' }, { status: 503 });
  }

  const rows = await db()<{ stripe_customer_id: string | null }[]>`
    select stripe_customer_id from app.subscription where user_id = ${user.userId} limit 1`;
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) return NextResponse.json({ error: 'no_customer' }, { status: 404 });

  const origin = new URL(req.url).origin;
  const portal = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/account`,
  });
  return NextResponse.json({ url: portal.url });
}
