/**
 * Billing webhook signature gate (M8). The load-bearing security property: a forged
 * or unsigned event is rejected (400) before any state change, and a validly-signed
 * event passes verification. Uses Stripe's own generateTestHeaderString so we test
 * the real constructEvent path (no DB needed — an unhandled event type returns 200
 * without touching the database).
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
});

async function postWebhook(body: string, signature?: string): Promise<Response> {
  const { POST } = await import('../src/app/api/billing/webhook/route');
  const headers: Record<string, string> = {};
  if (signature) headers['stripe-signature'] = signature;
  return POST(new Request('http://localhost/api/billing/webhook', { method: 'POST', headers, body }));
}

describe('billing webhook signature gate', () => {
  it('rejects a request with no signature (400)', async () => {
    const res = await postWebhook('{}');
    expect(res.status).toBe(400);
  });

  it('rejects a forged signature (400)', async () => {
    const res = await postWebhook(
      '{"id":"evt_1","type":"invoice.paid"}',
      't=123,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
    expect(res.status).toBe(400);
  });

  it('accepts a validly-signed event (200) without touching the DB on an unhandled type', async () => {
    const Stripe = (await import('stripe')).default;
    const s = new Stripe('sk_test_dummy_key');
    const payload = JSON.stringify({
      id: 'evt_ok',
      object: 'event',
      type: 'customer.created', // not in our switch → no DB write → 200
      data: { object: {} },
    });
    const header = s.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' });
    const res = await postWebhook(payload, header);
    expect(res.status).toBe(200);
  });
});
