/**
 * Billing-revision unit cover (M8): the access-control + pricing logic the paywall
 * and the owner-comp path lean on.
 *   1. isAdmin — the ADMIN_EMAILS allowlist (fail-closed, case/whitespace-insensitive).
 *   2. Stripe interval price selection — $20/yr (annual, default) + $2/mo (monthly),
 *      with annual falling back to the legacy single STRIPE_PRICE_ID for a clean cutover.
 * Pure env-driven functions — no DB, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAdmin } from '../src/lib/auth';
import { priceId, availableIntervals, stripeConfigured } from '../src/lib/stripe';

const PRICE_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_PRICE_ID_ANNUAL', 'STRIPE_PRICE_ID_MONTHLY'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of [...PRICE_KEYS, 'ADMIN_EMAILS']) saved[k] = process.env[k];
  for (const k of [...PRICE_KEYS, 'ADMIN_EMAILS']) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('isAdmin (ADMIN_EMAILS allowlist)', () => {
  it('fails closed when ADMIN_EMAILS is unset or the email is missing', () => {
    expect(isAdmin('aaron@buildwithstudio.com')).toBe(false);
    process.env.ADMIN_EMAILS = 'aaron@buildwithstudio.com';
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin('')).toBe(false);
  });

  it('matches a listed email case- and whitespace-insensitively', () => {
    process.env.ADMIN_EMAILS = ' Aaron@BuildWithStudio.com , owner@bandbox.pro ';
    expect(isAdmin('aaron@buildwithstudio.com')).toBe(true);
    expect(isAdmin('OWNER@BANDBOX.PRO')).toBe(true);
    expect(isAdmin('someone@else.com')).toBe(false);
  });
});

describe('Stripe interval price selection', () => {
  it('throws when no price is configured for the interval', () => {
    expect(() => priceId('annual')).toThrow();
    expect(() => priceId('monthly')).toThrow();
  });

  it('returns the per-interval prices when set; annual is the default', () => {
    process.env.STRIPE_PRICE_ID_ANNUAL = 'price_annual';
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly';
    expect(priceId('annual')).toBe('price_annual');
    expect(priceId('monthly')).toBe('price_monthly');
    expect(priceId()).toBe('price_annual'); // default
    expect(availableIntervals()).toEqual(['annual', 'monthly']);
  });

  it('falls back annual → legacy STRIPE_PRICE_ID (clean cutover from the old single price)', () => {
    process.env.STRIPE_PRICE_ID = 'price_legacy';
    expect(priceId('annual')).toBe('price_legacy');
    expect(availableIntervals()).toEqual(['annual']); // monthly not configured
    expect(() => priceId('monthly')).toThrow();
  });

  it('stripeConfigured needs the secret key AND at least one interval price', () => {
    expect(stripeConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(stripeConfigured()).toBe(false); // no price yet
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly';
    expect(stripeConfigured()).toBe(true);
  });
});
