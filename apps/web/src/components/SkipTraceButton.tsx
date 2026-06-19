'use client';

/**
 * SkipTraceButton — the BYO skip-trace contact-reveal affordance for a leads row
 * (PRD §7.3, §7.5, §8). POSTs the same-origin proxy /api/skiptrace/:pk and renders
 * the transient SkipTraceContact INLINE (the result is never persisted; the vendor
 * key is never seen by the client). Pre-auth — and any time the gates aren't met —
 * the proxy refuses and we show the honest reason, not a fake contact.
 *
 * Refusal → message map (the route's error bodies, §6 fail-closed order):
 *   401 auth_required · 403 attestation_required / no_skiptrace_key ·
 *   429 rate_limited · 400 unknown_vendor · 502 vendor_error.
 *   (subscription_required is dormant — monetization deferred to M8.)
 */
import { useState } from 'react';
import type { SkipTraceResult } from '@bandbox/core/contracts';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: SkipTraceResult }
  | { kind: 'refused'; message: string };

/** Map the proxy's {status, error} refusal to an honest, human one-liner. */
function refusalMessage(status: number, code: string | undefined): string {
  if (status === 401) return 'Sign in to skip-trace';
  if (status === 429) return 'Daily skip-trace cap reached';
  if (status === 404) return 'Parcel not found';
  switch (code) {
    case 'attestation_required':
      return 'Attest lawful use first';
    case 'no_skiptrace_key':
      return 'Add your vendor key';
    case 'forbidden_origin':
      return 'Blocked (cross-origin)';
    case 'unknown_vendor':
      return 'Unsupported vendor';
    case 'vendor_error':
      return 'Vendor lookup failed';
    default:
      return 'Skip-trace unavailable';
  }
}

export interface SkipTraceButtonProps {
  parcelPk: string;
}

export function SkipTraceButton({ parcelPk }: SkipTraceButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function run() {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/skiptrace/${encodeURIComponent(parcelPk)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      if (!res.ok) {
        let code: string | undefined;
        try {
          code = ((await res.json()) as { error?: string }).error;
        } catch {
          /* non-JSON refusal */
        }
        setState({ kind: 'refused', message: refusalMessage(res.status, code) });
        return;
      }
      const result = (await res.json()) as SkipTraceResult;
      setState({ kind: 'done', result });
    } catch {
      setState({ kind: 'refused', message: 'Skip-trace unavailable' });
    }
  }

  if (state.kind === 'done') {
    const c = state.result.contact;
    return (
      <div className="pb-skip-result" role="status">
        <span className="pb-skip-name">{c.name ?? '—'}</span>
        {c.phones.length > 0 ? <span className="pb-skip-line">{c.phones.join(' · ')}</span> : null}
        {c.emails.length > 0 ? <span className="pb-skip-line">{c.emails.join(' · ')}</span> : null}
        {c.phones.length === 0 && c.emails.length === 0 ? (
          <span className="pb-skip-line">No contact returned</span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="pb-leads-skip"
      onClick={run}
      disabled={state.kind === 'loading'}
      title="BYO skip-trace via your vendor key (auth + subscription + attestation)"
    >
      {state.kind === 'loading'
        ? 'Tracing…'
        : state.kind === 'refused'
          ? state.message
          : 'Skip-trace'}
    </button>
  );
}
