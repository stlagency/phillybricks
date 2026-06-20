/**
 * Server-side Supabase clients for the Next API routes (M7 auth seam, PRD §6).
 *
 * Two distinct clients, never mixed:
 *  - `supabaseAuthClient()` is bound to the ANON key and is used ONLY to validate
 *    a user's access token via `auth.getUser(jwt)` (GoTrue verifies the signature +
 *    expiry server-side and returns the user). It persists no session.
 *
 * The privileged Postgres work (reading app.* with RLS bypassed, decrypting Vault
 * secrets) goes through `lib/db` (the service connection), NOT through a Supabase
 * service-role client — so the secret-bearing path stays in one place.
 *
 * Env: reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (the same
 * values the browser client uses; on the server the NEXT_PUBLIC_ vars are present),
 * falling back to SUPABASE_URL / SUPABASE_ANON_KEY.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** First non-empty env var among the given names. */
function pickEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  return undefined;
}

export function supabaseUrl(): string | undefined {
  return pickEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
}

export function supabaseAnonKey(): string | undefined {
  return pickEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
}

let _authClient: SupabaseClient | null = null;

/**
 * Anon-key client used server-side only to validate a user JWT. Returns null when
 * Supabase env is unconfigured (so the auth seam fails closed → 401, not a crash).
 */
export function supabaseAuthClient(): SupabaseClient | null {
  if (_authClient) return _authClient;
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!url || !anon) return null;
  _authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _authClient;
}
