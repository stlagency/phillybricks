/**
 * POST /api/billing/webhook — the Stripe webhook (M8, PRD §6/§7.5). This is the ONLY
 * writer of app.subscription and the SOURCE OF TRUTH for entitlement (never the
 * checkout redirect, which can be skipped/replayed).
 *
 * Security/correctness:
 *  - Verifies the signature over the RAW body (req.text()) before trusting anything;
 *    an unverifiable event is 400'd.
 *  - Writes via the privileged server connection (app.subscription has no
 *    anon/authenticated write grant — PRD §3.6).
 *  - Idempotent: every write is an UPSERT keyed on user_id, so Stripe's at-least-once
 *    redelivery and out-of-order events converge to the same state.
 *  - Maps customer → user via app.subscription.stripe_customer_id, falling back to the
 *    Stripe customer's metadata.user_id (set at checkout) when the row isn't there yet.
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { db } from '../../../../lib/db';
import { stripe, webhookSecret } from '../../../../lib/stripe';

export const dynamic = 'force-dynamic';

type SubStatus = 'active' | 'inactive';

function mapStatus(s: Stripe.Subscription.Status): SubStatus {
  return s === 'active' || s === 'trialing' ? 'active' : 'inactive';
}

/** The current period end as ISO, robust across API versions (subscription or item). */
function periodEnd(sub: Stripe.Subscription): string | null {
  const a = sub as unknown as {
    current_period_end?: number;
    items?: { data?: { current_period_end?: number }[] };
  };
  const secs = a.current_period_end ?? a.items?.data?.[0]?.current_period_end;
  return typeof secs === 'number' ? new Date(secs * 1000).toISOString() : null;
}

/** Idempotent upsert keyed on the user. */
async function upsertByUser(
  userId: string,
  customerId: string,
  status: SubStatus,
  endIso: string | null,
): Promise<void> {
  await db()`
    insert into app.subscription (user_id, stripe_customer_id, status, current_period_end, updated_at)
    values (${userId}, ${customerId}, ${status}, ${endIso}::timestamptz, now())
    on conflict (user_id) do update set
      stripe_customer_id = excluded.stripe_customer_id,
      status = excluded.status,
      current_period_end = coalesce(excluded.current_period_end, app.subscription.current_period_end),
      updated_at = now()`;
}

/** Update by customer; if no row yet, resolve the user from the customer's metadata. */
async function upsertByCustomer(
  customerId: string,
  status: SubStatus,
  endIso: string | null,
): Promise<void> {
  const rows = await db()<{ user_id: string }[]>`
    update app.subscription set
      status = ${status},
      current_period_end = coalesce(${endIso}::timestamptz, current_period_end),
      updated_at = now()
    where stripe_customer_id = ${customerId}
    returning user_id`;
  if (rows.length > 0) return;
  const customer = await stripe().customers.retrieve(customerId);
  const userId = 'deleted' in customer ? undefined : customer.metadata?.user_id;
  if (userId) await upsertByUser(userId, customerId, status, endIso);
}

function asId(v: string | { id: string } | null | undefined): string | null {
  return typeof v === 'string' ? v : (v?.id ?? null);
}

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'no_signature' }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, webhookSecret());
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId = asId(session.customer as string | { id: string } | null);
        if (userId && customerId) {
          await upsertByUser(userId, customerId, 'active', null);
          const subId = asId(session.subscription as string | { id: string } | null);
          if (subId) {
            const sub = await stripe().subscriptions.retrieve(subId);
            await upsertByUser(userId, customerId, mapStatus(sub.status), periodEnd(sub));
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = asId(sub.customer as string | { id: string });
        if (customerId) {
          const status =
            event.type === 'customer.subscription.deleted' ? 'inactive' : mapStatus(sub.status);
          await upsertByCustomer(customerId, status, periodEnd(sub));
        }
        break;
      }
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = asId(inv.customer as string | { id: string } | null);
        if (customerId) await upsertByCustomer(customerId, 'active', null);
        break;
      }
      default:
        break;
    }
  } catch {
    // Generic 500 (no internals leaked) so Stripe retries the delivery.
    return NextResponse.json({ error: 'handler_error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
