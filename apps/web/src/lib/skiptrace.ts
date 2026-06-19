/**
 * BYO skip-trace proxy core (PRD §6 threat model, §7.5, §8). This is the privileged
 * server seam that forwards a lookup to a third-party vendor using the USER'S OWN
 * API key, and returns transient contact data to the session ONLY — it persists
 * nothing and NEVER logs/throws the key.
 *
 * Two invariants the whole milestone rests on:
 *   1. A vendor's base URL comes ONLY from the hardcoded SKIPTRACE_VENDORS allowlist
 *      below — never from the DB or user input. Server-Side-Request-Forgery is
 *      impossible because the user only ever picks an enum key, not a host.
 *   2. The plaintext key lives in memory for the duration of one request, is sent
 *      to exactly one allowlisted host, and is excluded from every error/log path.
 *
 * Everything here is injectable (fetchImpl, UsageStore, the clock via Date) so the
 * route stays a thin adapter and the security properties are unit-testable with no
 * network, no DB, and no real key. The route owns the only DB read of the key.
 */
import type {
  SkipTraceVendor,
  SkipTraceContact,
  SkipTraceResult,
} from '@bandbox/core/contracts';

/** The minimal parcel projection a vendor request needs (owner + mailing address). */
export interface SkipTraceParcel {
  parcel_pk: string;
  address: string | null;
  owner_1: string | null;
  owner_2: string | null;
  mailing_address: string | null;
}

/**
 * A single vendor's hardcoded adapter. `baseUrl` is a server constant — it is the
 * ONLY source of the request host (PRD §6). `buildRequest` shapes the outbound call
 * from the user's key + the parcel; `parseResponse` normalizes the vendor's body to
 * the frozen SkipTraceContact.
 */
export interface VendorAdapter {
  /** Hardcoded host — NEVER sourced from DB/user. */
  baseUrl: string;
  buildRequest(apiKey: string, parcel: SkipTraceParcel): { url: string; init: RequestInit };
  parseResponse(json: unknown): SkipTraceContact;
}

// ── typed errors (the route maps these to status codes) ──────────────────────

/** Vendor not on the server allowlist → the route returns 400. */
export class UnknownVendorError extends Error {
  constructor(public readonly vendor: string) {
    super(`unknown skip-trace vendor`);
    this.name = 'UnknownVendorError';
  }
}

/** Per-user daily cap reached → the route returns 429. */
export class RateLimitError extends Error {
  constructor(public readonly remaining: number = 0) {
    super(`skip-trace daily cap reached`);
    this.name = 'RateLimitError';
  }
}

/** Vendor call failed (network, timeout, non-2xx, unparseable body) → 502.
 *  The message is deliberately key-free; `cause` is whatever fetch threw. */
export class VendorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VendorError';
  }
}

// ── the vendor allowlist ─────────────────────────────────────────────────────

/** Pull a string field from an unknown JSON object without throwing. */
function str(obj: unknown, key: string): string | null {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/** Pull a string[] field, coercing scalars/objects defensively. */
function strArray(obj: unknown, key: string): string[] {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : null))
        .filter((x): x is string => x != null && x.length > 0);
    }
    if (typeof v === 'string' && v.length > 0) return [v];
  }
  return [];
}

/**
 * The server-side allowlist. Adding a vendor is the ONLY way to introduce a host.
 *
 * TODO-verify-against-vendor-docs: the exact endpoints, auth header style, request
 * body shape, and response field names below are best-effort placeholders — we have
 * no live key for any vendor yet (PRD §11). When a real key lands in M7, confirm
 * each adapter against the vendor's current API reference and adjust buildRequest /
 * parseResponse. The allowlist *mechanism* and base hosts are the load-bearing part.
 */
export const SKIPTRACE_VENDORS: Record<SkipTraceVendor, VendorAdapter> = {
  batchdata: {
    baseUrl: 'https://api.batchdata.com',
    buildRequest(apiKey, parcel) {
      return {
        url: `https://api.batchdata.com/api/v1/property/skip-trace`,
        init: {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                propertyAddress: parcel.address ?? undefined,
                mailAddress: parcel.mailing_address ?? undefined,
                name: parcel.owner_1 ?? undefined,
              },
            ],
          }),
        },
      };
    },
    parseResponse(json) {
      // TODO-verify-against-vendor-docs: BatchData nests results under results.persons[].
      const root = (json as Record<string, unknown> | null) ?? {};
      const results = (root['results'] as Record<string, unknown> | undefined) ?? root;
      const persons = (results['persons'] as unknown[] | undefined) ?? [];
      const person = persons[0] ?? results;
      return {
        name: str(person, 'name') ?? str(person, 'fullName'),
        phones: strArray(person, 'phoneNumbers').length
          ? strArray(person, 'phoneNumbers')
          : strArray(person, 'phones'),
        emails: strArray(person, 'emails'),
        mailing_address: str(person, 'mailingAddress') ?? str(person, 'address'),
      };
    },
  },

  reiskip: {
    baseUrl: 'https://api.reiskip.com',
    buildRequest(apiKey, parcel) {
      return {
        url: `https://api.reiskip.com/v1/skiptrace`,
        init: {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            owner_name: parcel.owner_1 ?? undefined,
            property_address: parcel.address ?? undefined,
            mailing_address: parcel.mailing_address ?? undefined,
          }),
        },
      };
    },
    parseResponse(json) {
      // TODO-verify-against-vendor-docs: REISkip flat output { name, phones[], emails[], mailing_address }.
      const root = (json as Record<string, unknown> | null) ?? {};
      const data = (root['data'] as Record<string, unknown> | undefined) ?? root;
      return {
        name: str(data, 'name') ?? str(data, 'owner_name'),
        phones: strArray(data, 'phones'),
        emails: strArray(data, 'emails'),
        mailing_address: str(data, 'mailing_address'),
      };
    },
  },

  endato: {
    baseUrl: 'https://devapi.endato.com',
    buildRequest(apiKey, parcel) {
      return {
        url: `https://devapi.endato.com/Address/Id`,
        init: {
          method: 'POST',
          headers: {
            // TODO-verify-against-vendor-docs: Endato uses paired galaxy-ap-name /
            // galaxy-ap-password headers; we carry the user's key in the password
            // slot until the real two-part credential is modeled.
            'galaxy-ap-name': 'bandbox',
            'galaxy-ap-password': apiKey,
            'galaxy-search-type': 'DevAPIContactID',
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            Name: parcel.owner_1 ?? undefined,
            Address: { addressLine1: parcel.mailing_address ?? parcel.address ?? undefined },
          }),
        },
      };
    },
    parseResponse(json) {
      // TODO-verify-against-vendor-docs: Endato returns person[] with phones/emails arrays.
      const root = (json as Record<string, unknown> | null) ?? {};
      const persons = (root['persons'] as unknown[] | undefined) ?? [];
      const person = persons[0] ?? root;
      return {
        name: str(person, 'name'),
        phones: strArray(person, 'phones'),
        emails: strArray(person, 'emails'),
        mailing_address: str(person, 'address'),
      };
    },
  },
};

// ── usage cap (per-user daily) ───────────────────────────────────────────────

/** A pluggable per-user usage gate. M7 swaps the in-memory default for a shared/DB
 *  store; the route depends only on this interface. */
export interface UsageStore {
  /** Is the user under their cap right now, and how many calls remain. */
  check(userId: string): { allowed: boolean; remaining: number };
  /** Record one successful call. */
  record(userId: string): void;
}

/**
 * In-memory per-user daily cap. WARNING: counts live in a single Node process, so
 * across serverless instances the effective cap is per-instance, not global. M7
 * must back this with a shared store (DB row / Redis / Supabase) for a true global
 * cap. Adequate today: there is one warm instance and no stored keys yet.
 */
export function createMemoryUsageStore(dailyCap = 50): UsageStore {
  const counts = new Map<string, { day: string; n: number }>();
  const today = (): string => new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

  function current(userId: string): number {
    const day = today();
    const entry = counts.get(userId);
    if (!entry || entry.day !== day) return 0;
    return entry.n;
  }

  return {
    check(userId) {
      const n = current(userId);
      const remaining = Math.max(0, dailyCap - n);
      return { allowed: n < dailyCap, remaining };
    },
    record(userId) {
      const day = today();
      const entry = counts.get(userId);
      if (!entry || entry.day !== day) counts.set(userId, { day, n: 1 });
      else entry.n += 1;
    },
  };
}

// ── the Vault seam ───────────────────────────────────────────────────────────

/**
 * Decrypt a stored skip-trace key.
 *
 * TODO(M7): wire Supabase Vault (decrypt server-side via the service role). The
 * route is the only caller and treats the output as the plaintext key. There are
 * NO stored keys yet, so today this is a base64 identity decode with a graceful
 * fallback — it exists only so the call site is real and the M7 change is one fn.
 */
export function decryptKey(encrypted: string): string {
  // M7: replace with Supabase Vault `decrypted_secret` lookup. Until then, treat the
  // stored value as base64(plaintext); if it isn't valid base64, pass it through.
  try {
    const decoded = Buffer.from(encrypted, 'base64').toString('utf8');
    // Re-encoding round-trips only for genuine base64 → guard against false decodes.
    if (Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') ===
        encrypted.replace(/=+$/, '')) {
      return decoded;
    }
  } catch {
    /* fall through to identity */
  }
  return encrypted;
}

// ── the injectable proxy core ────────────────────────────────────────────────

export interface RunSkipTraceArgs {
  userId: string;
  vendor: SkipTraceVendor | string;
  /** The user's plaintext key (already decrypted by the caller). */
  apiKey: string;
  parcel: SkipTraceParcel;
  store: UsageStore;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** True iff the vendor string is on the server allowlist. Narrows the type. */
export function isKnownVendor(vendor: string): vendor is SkipTraceVendor {
  return Object.prototype.hasOwnProperty.call(SKIPTRACE_VENDORS, vendor);
}

/**
 * Forward one skip-trace lookup to an allowlisted vendor and return transient
 * contact data. Pure of DB and persistence — it reads no database and writes
 * nothing. Throws typed errors the route maps to HTTP codes.
 *
 * Security: the apiKey is used to build exactly one request to the adapter's
 * hardcoded host and is never logged, never returned, and never put into a thrown
 * error message (only fetch's own `cause` carries through VendorError, and the
 * adapters never echo the key into the request URL).
 */
export async function runSkipTrace(args: RunSkipTraceArgs): Promise<SkipTraceResult> {
  const { userId, vendor, apiKey, parcel, store } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? 15_000;

  // 1. allowlist — the only host source.
  if (!isKnownVendor(vendor)) throw new UnknownVendorError(String(vendor));
  const adapter = SKIPTRACE_VENDORS[vendor];

  // 2. per-user cap.
  const gate = store.check(userId);
  if (!gate.allowed) throw new RateLimitError(gate.remaining);

  // 3. build + fire the vendor request with a hard timeout.
  const { url, init } = adapter.buildRequest(apiKey, parcel);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Never surface the key; fetch errors (incl. AbortError on timeout) become VendorError.
    const reason = err instanceof Error && err.name === 'AbortError' ? 'vendor request timed out' : 'vendor request failed';
    throw new VendorError(reason, { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new VendorError(`vendor returned ${res.status}`);

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new VendorError('vendor response was not JSON', { cause: err });
  }

  let contact: SkipTraceContact;
  try {
    contact = adapter.parseResponse(json);
  } catch (err) {
    throw new VendorError('vendor response could not be parsed', { cause: err });
  }

  // 4. record usage only on success, return transient result. Nothing persisted.
  store.record(userId);
  return {
    parcel_pk: parcel.parcel_pk,
    vendor,
    contact,
    looked_up_at: new Date().toISOString(),
  };
}
