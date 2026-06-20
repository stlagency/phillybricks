/**
 * Alert digest pipeline (M7). Drives runAlerts with a fake DbClient that answers
 * each query by pattern, and a recording EmailSender — asserting the classification
 * (subscribed-trigger filtering + matching-lead derivation), the durable feed write,
 * the email digest, and the last_sent_at advance.
 */
import { describe, it, expect } from 'vitest';
import { runAlerts } from '../src/alerts.js';
import type { DbClient } from '../src/db.js';
import type { EmailSender, SendEmailArgs } from '../src/email.js';

interface Handler {
  match: RegExp;
  rows: () => unknown[];
}

function fakeDb(handlers: Handler[]) {
  const calls: { q: string; values: unknown[] }[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ');
    calls.push({ q, values });
    for (const h of handlers) if (h.match.test(q)) return Promise.resolve(h.rows());
    return Promise.resolve([]);
  }) as unknown as DbClient & { calls: { q: string; values: unknown[] }[] };
  (fn as unknown as { unsafe: unknown }).unsafe = () => Promise.resolve([]);
  (fn as unknown as { begin: unknown }).begin = (cb: (tx: DbClient) => Promise<unknown>) => cb(fn);
  (fn as unknown as { calls: unknown }).calls = calls;
  return fn;
}

function recordingSender() {
  const sent: SendEmailArgs[] = [];
  const sender: EmailSender = {
    send: async (args) => {
      sent.push(args);
      return { ok: true, status: 200, id: 'm' };
    },
  };
  return { sender, sent };
}

const DUE_SUB = {
  id: 'sub1',
  user_id: 'u1',
  saved_area_id: 'area1',
  trigger_types: ['new_transaction', 'new_distress', 'new_matching_lead'],
  channel: 'email',
  unsub_token: 'tok',
  last_sent_at: null,
  area_name: 'Fishtown',
  email: 'aaron@example.com',
};

const FRESH = [
  { parcel_pk: 'P1', kind: 'transaction', label: 'sale_date', detail: null, on_date: '2026-06-15', address: '1 Main St' },
  { parcel_pk: 'P2', kind: 'tax', label: 'appeared', detail: '1200', on_date: '2026-06-15', address: '2 Main St' },
];

function handlers(sub: unknown = DUE_SUB, fresh: unknown[] = FRESH, hot: string[] = ['P1']): Handler[] {
  return [
    { match: /select[\s\S]*from app\.alert_subscription/i, rows: () => [sub] },
    { match: /from public\.parcel_change_log/i, rows: () => fresh },
    { match: /from public\.distress_signal/i, rows: () => hot.map((p) => ({ parcel_pk: p })) },
  ];
}

describe('runAlerts', () => {
  it('writes feed events for subscribed triggers + matching leads and emails a digest', async () => {
    const db = fakeDb(handlers());
    const { sender, sent } = recordingSender();

    const rep = await runAlerts(db, { send: sender, baseUrl: 'https://www.bandbox.pro' });

    // P1 transaction + P2 distress + P1 matching-lead = 3 events
    expect(rep.eventsInserted).toBe(3);
    expect(rep.emailsSent).toBe(1);
    expect(rep.subscriptionsProcessed).toBe(1);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('Fishtown');
    expect(sent[0]!.htmlBody).toContain('1 Main St');
    expect(sent[0]!.htmlBody).toContain('2 Main St');
    expect(sent[0]!.unsubscribeUrl).toContain('token=tok');

    const inserts = db.calls.filter((c) => /insert into app\.alert_event/i.test(c.q));
    expect(inserts).toHaveLength(3);
    const advances = db.calls.filter((c) => /update app\.alert_subscription set last_sent_at/i.test(c.q));
    expect(advances).toHaveLength(1);
  });

  it('filters out triggers the subscription did not request', async () => {
    const db = fakeDb(handlers({ ...DUE_SUB, trigger_types: ['new_transaction'] }));
    const { sender, sent } = recordingSender();

    const rep = await runAlerts(db, { send: sender });

    expect(rep.eventsInserted).toBe(1);
    expect(sent[0]!.htmlBody).toContain('1 Main St');
    expect(sent[0]!.htmlBody).not.toContain('2 Main St');
  });

  it('does not email an in_app-only subscription (feed still written)', async () => {
    const db = fakeDb(handlers({ ...DUE_SUB, channel: 'in_app' }));
    const { sender, sent } = recordingSender();

    const rep = await runAlerts(db, { send: sender });

    expect(rep.emailsSent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(rep.eventsInserted).toBe(3);
  });

  it('advances last_sent_at and sends nothing when there are no fresh rows', async () => {
    const db = fakeDb(handlers(DUE_SUB, []));
    const { sender, sent } = recordingSender();

    const rep = await runAlerts(db, { send: sender });

    expect(rep.eventsInserted).toBe(0);
    expect(sent).toHaveLength(0);
    const advances = db.calls.filter((c) => /update app\.alert_subscription set last_sent_at/i.test(c.q));
    expect(advances).toHaveLength(1);
  });
});
