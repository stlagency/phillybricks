'use client';

/**
 * Browser Supabase client (M7 auth). Holds the user's session (localStorage) and
 * auto-refreshes the access token. The token is attached to gated API calls by
 * lib/api-client; the server validates it in lib/auth getSession. Reads the public
 * NEXT_PUBLIC_SUPABASE_* env (inlined at build time).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — the browser auth client cannot initialize.',
    );
  }
  _client = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return _client;
}
