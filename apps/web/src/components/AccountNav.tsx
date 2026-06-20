'use client';

/**
 * AccountNav — the TopBand account control (M7). Shows "Sign in" when signed out,
 * or the user's email (→ /account) plus a sign-out button when signed in. Client
 * component; safe to nest in the server-rendered TopBand.
 */
import Link from 'next/link';
import { useSession } from '../lib/api-client';
import { supabaseBrowser } from '../lib/supabase-browser';

export function AccountNav() {
  const { user, loading } = useSession();

  if (loading) return null;
  if (!user) {
    return (
      <Link href="/login" className="pb-account-link">
        Sign in
      </Link>
    );
  }

  return (
    <span className="pb-account">
      <Link href="/account" className="pb-account-link" title={user.email ?? 'Account'}>
        {user.email ?? 'Account'}
      </Link>
      <button
        type="button"
        className="pb-account-signout"
        onClick={() => {
          void supabaseBrowser().auth.signOut();
        }}
      >
        Sign out
      </button>
    </span>
  );
}
