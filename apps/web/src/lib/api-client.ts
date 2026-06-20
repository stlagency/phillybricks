'use client';

/**
 * Client helpers for talking to the gated API routes (M7). `apiFetch` attaches the
 * current Supabase access token as `Authorization: Bearer …` so the server's
 * getSession can validate it; `useSession` exposes the live signed-in user.
 */
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase-browser';

/** fetch() with the current access token attached (when signed in). */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** The live signed-in user (null when signed out), with an initial loading flag. */
export function useSession(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supa = supabaseBrowser();
    supa.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supa.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
