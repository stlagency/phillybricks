/**
 * Server-only Stripe client + billing config (M8, PRD §7.5). NEVER imported into a
 * client component — STRIPE_SECRET_KEY must not reach the browser.
 *
 * The paywall is reversible by config: `billingEnabled()` reads BILLING_ENABLED, and
 * `requirePaid` (lib/auth) branches on it — so the two paid gates (CSV export,
 * skip-trace) fall back to free-for-authenticated the instant the flag is unset, with
 * no redeploy. app.subscription is written ONLY by the verified webhook.
 */
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

/** The Stripe client, or throw if unconfigured (callers gate on stripeConfigured). */
export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set — billing routes require it.');
  // Omit apiVersion to use the account default (matches the installed SDK's types).
  _stripe = new Stripe(key);
  return _stripe;
}

/** True when the secret key + price id are both configured (checkout is possible). */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

/** True when the paywall is armed (the paid gates require an active subscription). */
export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true';
}

/** The recurring monthly price the checkout subscribes to. */
export function priceId(): string {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id) throw new Error('STRIPE_PRICE_ID is not set.');
  return id;
}

/** The webhook signing secret used to verify inbound events. */
export function webhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  return s;
}
