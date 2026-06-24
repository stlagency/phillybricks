/**
 * Alert digest pipeline (M7, PRD §3.5, §4.1, §7). Runs at the END of the nightly,
 * after finalizeDerived (so distress_signal is fresh). For each due alert
 * subscription it:
 *   1. computes the parcels inside the saved area that had a FRESH record since the
 *      last digest (a sale/owner change, a tax-delinquency or L&I-violation event, a
 *      new permit) — purely in SQL, geometry never leaves the DB;
 *   2. writes one app.alert_event per matching (parcel, trigger) for the in-app feed;
 *   3. emails a digest (if the subscription's channel is email and a sender is wired);
 *   4. advances last_sent_at so the next run only sees newer changes.
 *
 * Fail-soft: a per-subscription error is logged and skipped; the run continues. The
 * in-app feed is the durable record — email is best-effort on top.
 *
 * Real-data only (the product promise): every digest line is a row from the public
 * record. No subscription, no due window → nothing sent.
 */
import type { DbClient } from './db.js';
import type { EmailSender } from './email.js';

export interface RunAlertsOptions {
  /** Wired in prod when ZEPTOMAIL_TOKEN is set; null ⇒ in-app feed only. */
  send?: EmailSender | null;
  /** Public origin for parcel + unsubscribe links. */
  baseUrl?: string;
  /** First-send lookback window in days (when last_sent_at is null). Default 7. */
  lookbackDays?: number;
  /** Max rows per trigger shown in a single digest. Default 50. */
  perTriggerCap?: number;
  /** When true (paywall armed), only process subscriptions whose owner is entitled
   *  ('active' paid or 'comped'); otherwise process all (default — free alerts). */
  entitledOnly?: boolean;
  log?: (m: string) => void;
}

export interface AlertsReport {
  subscriptionsProcessed: number;
  eventsInserted: number;
  emailsSent: number;
}

type TriggerType = 'new_transaction' | 'new_development' | 'new_distress' | 'new_matching_lead';

interface DueSub {
  id: string;
  user_id: string;
  saved_area_id: string;
  trigger_types: string[] | null;
  channel: string;
  unsub_token: string | null;
  last_sent_at: Date | null;
  area_name: string | null;
  email: string | null;
}

/** One fresh public-record row inside an area, pre-classification. */
interface FreshRow {
  parcel_pk: string;
  kind: 'transaction' | 'tax' | 'violation' | 'permit';
  label: string | null;
  detail: string | null;
  on_date: string | null;
  address: string | null;
}

/** A classified alert ready to insert + render. */
interface AlertItem {
  parcel_pk: string;
  trigger_type: TriggerType;
  address: string | null;
  summary: string;
  on_date: string | null;
}

const KIND_TO_TRIGGER: Record<FreshRow['kind'], TriggerType> = {
  transaction: 'new_transaction',
  tax: 'new_distress',
  violation: 'new_distress',
  permit: 'new_development',
};

/** YYYY-MM-DD for a Date (UTC). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Minimal HTML escaping for values interpolated into the digest. */
function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A human label for each trigger section in the digest. */
const TRIGGER_LABEL: Record<TriggerType, string> = {
  new_transaction: 'New sales / owner changes',
  new_development: 'New permits',
  new_distress: 'New distress signals',
  new_matching_lead: 'New high-distress leads',
};

/**
 * Fetch the fresh public-record rows inside one saved area since `since`. One union
 * query, spatially filtered by the area's geometry (resolved in a CTE so it never
 * crosses the wire). Bounded by `hardCap` rows total.
 */
async function fetchFreshRows(
  db: DbClient,
  areaId: string,
  since: string,
  hardCap: number,
): Promise<FreshRow[]> {
  return db<FreshRow[]>`
    with area as (select geom from app.saved_area where id = ${areaId})
    select * from (
      select pcl.parcel_pk, 'transaction' as kind,
             pcl.field as label, pcl.new_value as detail,
             pcl.changed_on::text as on_date, p.address
      from public.parcel_change_log pcl
      join public.parcel p on p.parcel_pk = pcl.parcel_pk
      where pcl.field in ('sale_date', 'sale_price', 'owner_1')
        and pcl.old_value is not null
        and pcl.changed_on >= ${since}
        and st_contains((select geom from area), p.geom)
      union all
      select de.parcel_pk, 'tax' as kind,
             de.event_type as label, de.total_due::text as detail,
             de.observed_on::text as on_date, p.address
      from public.delinquency_event de
      join public.parcel p on p.parcel_pk = de.parcel_pk
      where de.event_type in ('appeared', 'reappeared')
        and de.observed_on >= ${since}
        and st_contains((select geom from area), p.geom)
      union all
      select ve.parcel_pk, 'violation' as kind,
             ve.event_type as label, null as detail,
             ve.observed_on::text as on_date, p.address
      from public.violation_event ve
      join public.parcel p on p.parcel_pk = ve.parcel_pk
      where ve.event_type in ('appeared', 'reappeared')
        and ve.observed_on >= ${since}
        and st_contains((select geom from area), p.geom)
      union all
      select pm.parcel_pk, 'permit' as kind,
             pm.permit_type as label, pm.permit_description as detail,
             pm.permit_issued_date::text as on_date, p.address
      from public.permit pm
      join public.parcel p on p.parcel_pk = pm.parcel_pk
      where pm.permit_issued_date >= ${since}
        and st_contains((select geom from area), p.geom)
    ) u
    limit ${hardCap}`;
}

/**
 * The "lead" distress floor — matches the Leads UI default (DEFAULT_MIN_SCORE), so a
 * new_matching_lead alert fires for the same parcels the user would see in their list.
 */
const LEAD_SCORE_FLOOR = 0.3;

/** The subset of candidate parcels currently at/above the lead distress floor. */
async function highDistressParcels(db: DbClient, pks: string[]): Promise<Set<string>> {
  if (pks.length === 0) return new Set();
  const rows = await db<{ parcel_pk: string }[]>`
    select parcel_pk from public.distress_signal
    where parcel_pk = any(${pks}::text[]) and score01 >= ${LEAD_SCORE_FLOOR}`;
  return new Set(rows.map((r) => r.parcel_pk));
}

/** Build the digest HTML for one user's items (already filtered + capped). */
function renderDigest(
  areaName: string | null,
  items: AlertItem[],
  baseUrl: string,
  unsubUrl: string | null,
  perTriggerCap: number,
): { subject: string; html: string; text: string } {
  const area = areaName || 'your saved area';
  const subject = `Bandbox: ${items.length} new change${items.length === 1 ? '' : 's'} in ${area}`;

  const order: TriggerType[] = [
    'new_transaction',
    'new_distress',
    'new_development',
    'new_matching_lead',
  ];
  const sections: string[] = [];
  const textLines: string[] = [`Bandbox digest — ${area}`, ''];

  for (const t of order) {
    const group = items.filter((i) => i.trigger_type === t);
    if (group.length === 0) continue;
    const shown = group.slice(0, perTriggerCap);
    const rows = shown
      .map((i) => {
        const url = `${baseUrl}/parcel/${encodeURIComponent(i.parcel_pk)}`;
        const addr = esc(i.address) || esc(i.parcel_pk);
        return `<tr><td style="padding:6px 0;border-bottom:1px solid #e7e0d4">
          <a href="${url}" style="color:#0A2A5E;font-weight:600;text-decoration:none">${addr}</a>
          <div style="color:#6b6457;font-size:13px">${esc(i.summary)}${i.on_date ? ` · ${esc(i.on_date)}` : ''}</div>
        </td></tr>`;
      })
      .join('');
    const more = group.length > shown.length ? `<p style="color:#6b6457;font-size:13px">+${group.length - shown.length} more</p>` : '';
    sections.push(
      `<h2 style="font-size:15px;color:#0A2A5E;margin:20px 0 8px">${TRIGGER_LABEL[t]} (${group.length})</h2>
       <table style="width:100%;border-collapse:collapse">${rows}</table>${more}`,
    );
    textLines.push(`${TRIGGER_LABEL[t]} (${group.length}):`);
    for (const i of shown) textLines.push(`  - ${i.address || i.parcel_pk}: ${i.summary}${i.on_date ? ` (${i.on_date})` : ''}`);
    if (group.length > shown.length) textLines.push(`  +${group.length - shown.length} more`);
    textLines.push('');
  }

  const unsubHtml = unsubUrl
    ? `<p style="color:#9a9282;font-size:12px;margin-top:24px">
         You're getting this because you saved an area on Bandbox.
         <a href="${unsubUrl}" style="color:#9a9282">Unsubscribe</a>.</p>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:system-ui,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="font-family:Georgia,serif;font-weight:700;color:#0A2A5E;font-size:20px;letter-spacing:1px">BAND/BOX</div>
      <p style="color:#3a352c">New activity in <strong>${esc(area)}</strong> from the public record.</p>
      ${sections.join('')}
      ${unsubHtml}
    </div></body></html>`;

  if (unsubUrl) textLines.push(`Unsubscribe: ${unsubUrl}`);
  return { subject, html, text: textLines.join('\n') };
}

/**
 * Run the alert digests. Returns a small report. Opt-in email (a sender is only
 * passed when ZEPTOMAIL_TOKEN is configured); the in-app feed is always written.
 */
export async function runAlerts(db: DbClient, opts: RunAlertsOptions = {}): Promise<AlertsReport> {
  const log = opts.log ?? (() => {});
  const baseUrl = (opts.baseUrl ?? 'https://www.bandbox.pro').replace(/\/+$/, '');
  const lookbackDays = opts.lookbackDays ?? 7;
  const perTriggerCap = opts.perTriggerCap ?? 50;
  const hardCap = 2000;

  // Due = daily subscriptions not sent in the last 20h (survives a double nightly).
  // Recipient email comes from app.profile (denormalized at request time) so this
  // worker needs no auth.users privilege. When entitledOnly (paywall armed), an
  // EXISTS gate restricts the run to owners with an 'active' or 'comped' entitlement
  // — so flipping BILLING_ENABLED also stops digests to lapsed/free users, not just
  // the API surface that creates them.
  const entitledOnly = opts.entitledOnly ?? false;
  const subs = entitledOnly
    ? await db<DueSub[]>`
        select s.id, s.user_id, s.saved_area_id, s.trigger_types, s.channel, s.unsub_token,
               s.last_sent_at, a.name as area_name, pr.email
        from app.alert_subscription s
        join app.saved_area a on a.id = s.saved_area_id and a.user_id = s.user_id
        left join app.profile pr on pr.id = s.user_id
        where s.frequency = 'daily'
          and (s.last_sent_at is null or s.last_sent_at < now() - interval '20 hours')
          and exists (select 1 from app.subscription sub
                      where sub.user_id = s.user_id and sub.status in ('active', 'comped'))`
    : await db<DueSub[]>`
        select s.id, s.user_id, s.saved_area_id, s.trigger_types, s.channel, s.unsub_token,
               s.last_sent_at, a.name as area_name, pr.email
        from app.alert_subscription s
        join app.saved_area a on a.id = s.saved_area_id and a.user_id = s.user_id
        left join app.profile pr on pr.id = s.user_id
        where s.frequency = 'daily'
          and (s.last_sent_at is null or s.last_sent_at < now() - interval '20 hours')`;

  let eventsInserted = 0;
  let emailsSent = 0;

  for (const sub of subs) {
    try {
      const triggers = new Set((sub.trigger_types ?? []) as TriggerType[]);
      if (triggers.size === 0) {
        await db`update app.alert_subscription set last_sent_at = now() where id = ${sub.id}`;
        continue;
      }

      // since = the last digest's day, else `lookbackDays` ago (first send).
      const since = sub.last_sent_at
        ? ymd(sub.last_sent_at)
        : ymd(new Date(Date.now() - lookbackDays * 86_400_000));

      const fresh = await fetchFreshRows(db, sub.saved_area_id, since, hardCap);

      // Classify direct triggers.
      const items: AlertItem[] = [];
      for (const r of fresh) {
        const trig = KIND_TO_TRIGGER[r.kind];
        if (!triggers.has(trig)) continue;
        items.push({
          parcel_pk: r.parcel_pk,
          trigger_type: trig,
          address: r.address,
          summary: summarize(r),
          on_date: r.on_date,
        });
      }

      // new_matching_lead: candidate parcels that are currently high-distress.
      if (triggers.has('new_matching_lead')) {
        const candidates = [...new Set(fresh.map((r) => r.parcel_pk))];
        const hot = await highDistressParcels(db, candidates);
        const seen = new Set<string>();
        for (const r of fresh) {
          if (!hot.has(r.parcel_pk) || seen.has(r.parcel_pk)) continue;
          seen.add(r.parcel_pk);
          items.push({
            parcel_pk: r.parcel_pk,
            trigger_type: 'new_matching_lead',
            address: r.address,
            summary: 'High-distress parcel with new public-record activity',
            on_date: r.on_date,
          });
        }
      }

      // Dedup against alerts already delivered to this user. The window is DATE-
      // granular (changed_on/observed_on are dates) and `since` = the last digest's
      // calendar day, so each run re-queries that whole day; drop anything already
      // recorded (by parcel + trigger + event date) so neither the feed nor the
      // email repeats — while still catching genuinely new same-day events.
      const existing = await db<{ k: string }[]>`
        select distinct
          (parcel_pk || '|' || trigger_type || '|' || coalesce(payload->>'on_date', '')) as k
        from app.alert_event
        where user_id = ${sub.user_id} and created_at >= now() - interval '9 days'`;
      const seenKeys = new Set(existing.map((r) => r.k));
      const pending = items.filter(
        (it) => !seenKeys.has(`${it.parcel_pk}|${it.trigger_type}|${it.on_date ?? ''}`),
      );

      if (pending.length === 0) {
        await db`update app.alert_subscription set last_sent_at = now() where id = ${sub.id}`;
        continue;
      }

      // 2. write the in-app feed (durable record), one row per item.
      for (const it of pending) {
        const payload = JSON.stringify({
          address: it.address,
          summary: it.summary,
          on_date: it.on_date,
          area: sub.area_name,
        });
        await db`
          insert into app.alert_event (user_id, parcel_pk, trigger_type, payload)
          values (${sub.user_id}, ${it.parcel_pk}, ${it.trigger_type}, ${payload}::jsonb)`;
        eventsInserted += 1;
      }

      // 3. email digest (best-effort, only if a sender + recipient + email channel).
      if (sub.channel === 'email' && opts.send && sub.email) {
        const unsubUrl = sub.unsub_token
          ? `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(sub.unsub_token)}`
          : null;
        const { subject, html, text } = renderDigest(sub.area_name, pending, baseUrl, unsubUrl, perTriggerCap);
        const res = await opts.send.send({
          to: [{ address: sub.email }],
          subject,
          htmlBody: html,
          textBody: text,
          unsubscribeUrl: unsubUrl ?? undefined,
        });
        if (res.ok) emailsSent += 1;
        else log(`alert email to ${sub.email} failed (status ${res.status}${res.error ? ` ${res.error}` : ''})`);
      }

      // 4. advance the window.
      await db`update app.alert_subscription set last_sent_at = now() where id = ${sub.id}`;
    } catch (err) {
      log(`alert subscription ${sub.id} failed (skipped): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`alerts: ${subs.length} subscription(s), ${eventsInserted} feed event(s), ${emailsSent} email(s).`);
  return { subscriptionsProcessed: subs.length, eventsInserted, emailsSent };
}

/** A short human summary for one fresh row. */
function summarize(r: FreshRow): string {
  switch (r.kind) {
    case 'transaction':
      return r.label === 'sale_date'
        ? 'New recorded sale date'
        : r.label === 'sale_price'
          ? `New sale price${r.detail ? ` ${r.detail}` : ''}`
          : 'Owner change';
    case 'tax':
      return `Tax delinquency ${r.label ?? 'event'}${r.detail ? ` ($${r.detail})` : ''}`;
    case 'violation':
      return `L&I violation ${r.label ?? 'event'}`;
    case 'permit':
      return `Permit: ${r.label ?? 'issued'}${r.detail ? ` — ${r.detail}` : ''}`;
    default:
      return 'New public-record activity';
  }
}
