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

/** The billing intervals the checkout offers (launch pricing: $2/mo, $20/yr). */
export type BillingInterval = 'monthly' | 'annual';

/** The configured Stripe price id for an interval, or null when unset.
 *  Annual falls back to the legacy single STRIPE_PRICE_ID for a clean cutover. */
function priceIdFor(interval: BillingInterval): string | null {
  if (interval === 'monthly') return process.env.STRIPE_PRICE_ID_MONTHLY || null;
  return process.env.STRIPE_PRICE_ID_ANNUAL || process.env.STRIPE_PRICE_ID || null;
}

/** True when the secret key + at least one interval price are configured
 *  (checkout is possible for that interval). */
export function stripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && (priceIdFor('annual') || priceIdFor('monthly')),
  );
}

/** True when the paywall is armed (the paid gates require an active subscription). */
export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true';
}

/** The recurring price the checkout subscribes to, for the chosen interval.
 *  Callers gate on stripeConfigured(); this throws if that interval is unset. */
export function priceId(interval: BillingInterval = 'annual'): string {
  const id = priceIdFor(interval);
  if (!id) {
    throw new Error(
      `No Stripe price configured for ${interval} (set STRIPE_PRICE_ID_${interval.toUpperCase()}).`,
    );
  }
  return id;
}

/** Which intervals are currently purchasable (have a configured price). */
export function availableIntervals(): BillingInterval[] {
  return (['annual', 'monthly'] as BillingInterval[]).filter((i) => priceIdFor(i));
}

/** The webhook signing secret used to verify inbound events. */
export function webhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  return s;
}
