'use client';

/**
 * AccountView — the M7 account surface. Signed-out users are sent to /login.
 * Sections: account/attestation, BYO skip-trace key, saved areas, alert
 * subscriptions, and the alert feed. Every mutating call goes through apiFetch
 * (which attaches the Bearer token) and is same-origin (CSRF-safe).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AccountProfile,
  AlertEvent,
  AlertSubscription,
  AlertTriggerType,
  SavedArea,
  SkipTraceVendor,
} from '@bandbox/core/contracts';
import { apiFetch, useSession } from '../../lib/api-client';

const VENDORS: SkipTraceVendor[] = ['batchdata', 'reiskip', 'endato'];
const TRIGGERS: { key: AlertTriggerType; label: string }[] = [
  { key: 'new_transaction', label: 'New sales / owner changes' },
  { key: 'new_distress', label: 'New distress signals' },
  { key: 'new_development', label: 'New permits' },
  { key: 'new_matching_lead', label: 'New high-distress leads' },
];

export function AccountView() {
  const { user, loading } = useSession();
  const router = useRouter();

  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [areas, setAreas] = useState<SavedArea[]>([]);
  const [subs, setSubs] = useState<AlertSubscription[]>([]);
  const [feed, setFeed] = useState<AlertEvent[]>([]);

  const refresh = useCallback(async () => {
    const [a, ar, su, fe] = await Promise.all([
      apiFetch('/api/account').then((r) => (r.ok ? (r.json() as Promise<AccountProfile>) : null)),
      apiFetch('/api/areas').then((r) => (r.ok ? (r.json() as Promise<SavedArea[]>) : [])),
      apiFetch('/api/alerts/subscriptions').then((r) =>
        r.ok ? (r.json() as Promise<AlertSubscription[]>) : [],
      ),
      apiFetch('/api/alerts').then((r) => (r.ok ? (r.json() as Promise<AlertEvent[]>) : [])),
    ]);
    setAccount(a);
    setAreas(ar);
    setSubs(su);
    setFeed(fe);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    void refresh();
  }, [user, loading, router, refresh]);

  if (loading || !user) return <p className="pb-account-loading">Loading…</p>;

  // When the paywall is armed and the user isn't entitled (paid or comped), the
  // areas/alerts API returns 403 — reflect that in the UI instead of empty cards.
  const entitled =
    account?.subscription_status === 'active' || account?.subscription_status === 'comped';
  const gated = Boolean(account?.billing_enabled) && !entitled;

  return (
    <div className="pb-account-grid">
      <header className="pb-account-head">
        <p className="pb-kicker">Your account</p>
        <h1>{account?.email ?? user.email ?? 'Account'}</h1>
      </header>

      <BillingCard account={account} />
      <AttestationCard account={account} onChange={refresh} />
      <SkiptraceKeyCard account={account} onChange={refresh} />
      <SavedAreasCard areas={areas} onChange={refresh} gated={gated} />
      <AlertsCard areas={areas} subs={subs} onChange={refresh} gated={gated} />
      <FeedCard feed={feed} onChange={refresh} />
    </div>
  );
}

/* ── Billing (M8) ────────────────────────────────────────────────────────── */
function BillingCard({ account }: { account: AccountProfile | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Surface the post-Checkout redirect outcome (?billing=success|cancel).
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('billing');
    if (b === 'success') setMsg('Subscription started — thank you! It may take a moment to activate.');
    else if (b === 'cancel') setMsg('Checkout canceled.');
  }, []);

  async function go(path: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const { url } = (await res.json()) as { url?: string };
        if (url) {
          window.location.href = url;
          return;
        }
        setMsg('Could not open billing.');
      } else if (res.status === 503) {
        setMsg('Billing is not configured yet.');
      } else {
        setMsg('Could not open billing.');
      }
    } catch {
      setMsg('Could not open billing.');
    }
    setBusy(false);
  }

  const status = account?.subscription_status ?? null;
  const paid = status === 'active';
  const comped = status === 'comped';
  return (
    <section className="pb-card">
      <h2>
        Billing {account && !account.billing_enabled ? <span className="pb-muted">(paywall off)</span> : null}
      </h2>
      <p className="pb-card-note">
        {account?.billing_enabled
          ? 'CSV export, skip-trace, and saved-area alerts require a subscription.'
          : 'CSV export, skip-trace, and saved-area alerts are currently free for signed-in users.'}
      </p>
      <p className="pb-status">
        Status:{' '}
        <strong className={paid || comped ? 'pb-ok' : 'pb-off'}>
          {comped ? 'comped (free access)' : (status ?? 'none')}
        </strong>
        {paid && account?.current_period_end
          ? ` · renews ${new Date(account.current_period_end).toLocaleDateString()}`
          : ''}
      </p>
      {paid ? (
        <button className="pb-btn pb-btn-secondary" onClick={() => go('/api/billing/portal')} disabled={busy}>
          Manage billing
        </button>
      ) : comped ? (
        <p className="pb-card-note">Your account is comped — full access, no payment needed.</p>
      ) : (
        <div className="pb-cta-row">
          <button
            className="pb-btn pb-btn-primary"
            onClick={() => go('/api/billing/checkout', { interval: 'annual' })}
            disabled={busy}
          >
            Subscribe — $20/year →
          </button>
          <button
            className="pb-btn pb-btn-secondary"
            onClick={() => go('/api/billing/checkout', { interval: 'monthly' })}
            disabled={busy}
          >
            or $2/month
          </button>
        </div>
      )}
      {msg ? <p className="pb-auth-msg">{msg}</p> : null}
    </section>
  );
}

/* ── Skip-trace attestation ──────────────────────────────────────────────── */
function AttestationCard({
  account,
  onChange,
}: {
  account: AccountProfile | null;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const attested = Boolean(account?.attested_skiptrace_at);

  async function toggle() {
    setBusy(true);
    await apiFetch('/api/account/attest', { method: attested ? 'DELETE' : 'POST' });
    await onChange();
    setBusy(false);
  }

  return (
    <section className="pb-card">
      <h2>Skip-trace attestation</h2>
      <p className="pb-card-note">
        Required before any skip-trace lookup. By attesting you confirm you will use
        owner contact data only for lawful, permissible purposes.
      </p>
      <p className="pb-status">
        Status:{' '}
        <strong className={attested ? 'pb-ok' : 'pb-off'}>
          {attested ? 'Attested' : 'Not attested'}
        </strong>
      </p>
      <button className="pb-btn pb-btn-secondary" onClick={toggle} disabled={busy}>
        {attested ? 'Revoke attestation' : 'I attest →'}
      </button>
    </section>
  );
}

/* ── BYO skip-trace key ──────────────────────────────────────────────────── */
function SkiptraceKeyCard({
  account,
  onChange,
}: {
  account: AccountProfile | null;
  onChange: () => Promise<void>;
}) {
  const [vendor, setVendor] = useState<SkipTraceVendor>('batchdata');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!key.trim()) return setMsg('Enter your vendor API key.');
    setBusy(true);
    setMsg(null);
    const res = await apiFetch('/api/skiptrace/key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor, api_key: key.trim() }),
    });
    setKey('');
    setMsg(res.ok ? 'Key stored securely.' : 'Could not store key.');
    await onChange();
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    await apiFetch('/api/skiptrace/key', { method: 'DELETE' });
    setMsg('Key removed.');
    await onChange();
    setBusy(false);
  }

  return (
    <section className="pb-card">
      <h2>Skip-trace key (bring your own)</h2>
      <p className="pb-card-note">
        Your key is encrypted at rest in Supabase Vault and is never shown again,
        never logged, and never leaves the server except to your chosen vendor.
      </p>
      <p className="pb-status">
        On file:{' '}
        <strong className={account?.has_skiptrace_key ? 'pb-ok' : 'pb-off'}>
          {account?.has_skiptrace_key ? `Yes (${account.skiptrace_vendor})` : 'No key'}
        </strong>
      </p>
      <div className="pb-field-row">
        <select value={vendor} onChange={(e) => setVendor(e.target.value as SkipTraceVendor)}>
          {VENDORS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="password"
          placeholder="Vendor API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="pb-btn pb-btn-primary" onClick={save} disabled={busy}>
          Save key
        </button>
        {account?.has_skiptrace_key ? (
          <button className="pb-btn pb-btn-secondary" onClick={remove} disabled={busy}>
            Remove
          </button>
        ) : null}
      </div>
      {msg ? <p className="pb-auth-msg">{msg}</p> : null}
    </section>
  );
}

/* ── Saved areas ─────────────────────────────────────────────────────────── */
function SavedAreasCard({
  areas,
  onChange,
  gated,
}: {
  areas: SavedArea[];
  onChange: () => Promise<void>;
  gated: boolean;
}) {
  const [mode, setMode] = useState<'canonical' | 'radius'>('canonical');
  const [name, setName] = useState('');
  const [geoId, setGeoId] = useState('');
  const [lon, setLon] = useState('');
  const [lat, setLat] = useState('');
  const [radius, setRadius] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setMsg(null);
    const body =
      mode === 'canonical'
        ? { name: name || null, kind: 'canonical', geo_type: 'neighborhood', geo_id: geoId.trim() }
        : {
            name: name || null,
            kind: 'radius',
            center: { lon: Number(lon), lat: Number(lat) },
            radius_m: Number(radius),
          };
    const res = await apiFetch('/api/areas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setMsg(res.ok ? 'Area saved.' : `Could not save (${(await res.json().catch(() => ({}))).error ?? res.status}).`);
    if (res.ok) {
      setName('');
      setGeoId('');
    }
    await onChange();
    setBusy(false);
  }

  async function remove(id: string) {
    await apiFetch(`/api/areas/${id}`, { method: 'DELETE' });
    await onChange();
  }

  return (
    <section className="pb-card">
      <h2>Saved areas</h2>
      <p className="pb-card-note">A saved area is the geography your alerts watch.</p>
      {gated ? (
        <p className="pb-card-note pb-off">Subscribe to create and manage saved areas.</p>
      ) : null}

      <ul className="pb-list">
        {areas.length === 0 ? <li className="pb-muted">No saved areas yet.</li> : null}
        {areas.map((a) => (
          <li key={a.id} className="pb-list-row">
            <span>
              <strong>{a.name || '(unnamed)'}</strong> <em className="pb-muted">{a.kind}</em>
            </span>
            <button className="pb-linkbtn" onClick={() => remove(a.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <div className="pb-field-row">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'canonical' | 'radius')}>
          <option value="canonical">Neighborhood</option>
          <option value="radius">Radius</option>
        </select>
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        {mode === 'canonical' ? (
          <input
            placeholder="Neighborhood geo_id"
            value={geoId}
            onChange={(e) => setGeoId(e.target.value)}
          />
        ) : (
          <>
            <input placeholder="lon" value={lon} onChange={(e) => setLon(e.target.value)} />
            <input placeholder="lat" value={lat} onChange={(e) => setLat(e.target.value)} />
            <input placeholder="radius (m)" value={radius} onChange={(e) => setRadius(e.target.value)} />
          </>
        )}
        <button className="pb-btn pb-btn-primary" onClick={create} disabled={busy || gated}>
          Save area
        </button>
      </div>
      {msg ? <p className="pb-auth-msg">{msg}</p> : null}
    </section>
  );
}

/* ── Alert subscriptions ─────────────────────────────────────────────────── */
function AlertsCard({
  areas,
  subs,
  onChange,
  gated,
}: {
  areas: SavedArea[];
  subs: AlertSubscription[];
  onChange: () => Promise<void>;
  gated: boolean;
}) {
  const [areaId, setAreaId] = useState('');
  const [picked, setPicked] = useState<Set<AlertTriggerType>>(new Set(['new_distress']));
  const [channel, setChannel] = useState<'email' | 'in_app'>('email');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(t: AlertTriggerType) {
    const next = new Set(picked);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setPicked(next);
  }

  async function create() {
    const id = areaId || areas[0]?.id;
    if (!id) return setMsg('Save an area first.');
    if (picked.size === 0) return setMsg('Pick at least one trigger.');
    setBusy(true);
    setMsg(null);
    const res = await apiFetch('/api/alerts/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ saved_area_id: id, trigger_types: [...picked], channel }),
    });
    setMsg(res.ok ? 'Alert created.' : 'Could not create alert.');
    await onChange();
    setBusy(false);
  }

  async function remove(id: string) {
    await apiFetch(`/api/alerts/subscriptions/${id}`, { method: 'DELETE' });
    await onChange();
  }

  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name || '(area)';

  return (
    <section className="pb-card">
      <h2>Alerts</h2>
      <p className="pb-card-note">
        A nightly digest of new public-record activity in a saved area. Email sends
        are open- and click-tracked; one-click unsubscribe is in every message.
      </p>
      {gated ? (
        <p className="pb-card-note pb-off">Subscribe to create and receive alerts.</p>
      ) : null}

      <ul className="pb-list">
        {subs.length === 0 ? <li className="pb-muted">No alerts yet.</li> : null}
        {subs.map((s) => (
          <li key={s.id} className="pb-list-row">
            <span>
              <strong>{areaName(s.saved_area_id)}</strong>{' '}
              <em className="pb-muted">
                {s.trigger_types.length} trigger{s.trigger_types.length === 1 ? '' : 's'} · {s.channel}
              </em>
            </span>
            <button className="pb-linkbtn" onClick={() => remove(s.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <div className="pb-field-col">
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">{areas[0] ? 'Pick an area…' : 'Save an area first'}</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || '(unnamed)'} — {a.kind}
            </option>
          ))}
        </select>
        <div className="pb-checks">
          {TRIGGERS.map((t) => (
            <label key={t.key} className="pb-check">
              <input type="checkbox" checked={picked.has(t.key)} onChange={() => toggle(t.key)} />
              {t.label}
            </label>
          ))}
        </div>
        <div className="pb-field-row">
          <select value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'in_app')}>
            <option value="email">Email digest</option>
            <option value="in_app">In-app only</option>
          </select>
          <button className="pb-btn pb-btn-primary" onClick={create} disabled={busy || gated}>
            Create alert
          </button>
        </div>
      </div>
      {msg ? <p className="pb-auth-msg">{msg}</p> : null}
    </section>
  );
}

/* ── Alert feed ──────────────────────────────────────────────────────────── */
function FeedCard({ feed, onChange }: { feed: AlertEvent[]; onChange: () => Promise<void> }) {
  async function markAll() {
    await apiFetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    await onChange();
  }

  const unread = feed.filter((e) => !e.read_at).length;

  return (
    <section className="pb-card">
      <h2>
        Alert feed {unread > 0 ? <span className="pb-badge">{unread}</span> : null}
      </h2>
      {feed.length === 0 ? (
        <p className="pb-muted">No alerts yet — they appear here after the nightly run.</p>
      ) : (
        <>
          <button className="pb-linkbtn" onClick={markAll} disabled={unread === 0}>
            Mark all read
          </button>
          <ul className="pb-list">
            {feed.map((e) => {
              const summary =
                typeof e.payload?.summary === 'string' ? e.payload.summary : e.trigger_type;
              const addr = typeof e.payload?.address === 'string' ? e.payload.address : e.parcel_pk;
              return (
                <li key={e.id} className={`pb-list-row ${e.read_at ? '' : 'pb-unread'}`}>
                  <span>
                    {e.parcel_pk ? (
                      <Link href={`/parcel/${e.parcel_pk}`}>
                        <strong>{addr}</strong>
                      </Link>
                    ) : (
                      <strong>{addr}</strong>
                    )}{' '}
                    <em className="pb-muted">{summary}</em>
                  </span>
                  <span className="pb-muted">{new Date(e.created_at).toLocaleDateString()}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
