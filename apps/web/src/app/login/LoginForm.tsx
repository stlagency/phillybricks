'use client';

/**
 * LoginForm — email+password sign in / create account, with a magic-link fallback
 * (M7). On a session it redirects to /account. Uses the browser Supabase client;
 * the session it establishes is what lib/api-client attaches to gated API calls.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../lib/supabase-browser';

type Mode = 'signin' | 'signup';

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supa = supabaseBrowser();
    try {
      if (mode === 'signin') {
        const { error } = await supa.auth.signInWithPassword({ email, password });
        if (error) return setMsg(error.message);
        router.push('/account');
        router.refresh();
      } else {
        const { data, error } = await supa.auth.signUp({ email, password });
        if (error) return setMsg(error.message);
        if (data.session) {
          router.push('/account');
          router.refresh();
        } else {
          setMsg('Account created — check your email to confirm, then sign in.');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function magicLink() {
    if (!email) return setMsg('Enter your email first.');
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/account` },
    });
    setBusy(false);
    setMsg(error ? error.message : 'Magic link sent — check your email.');
  }

  return (
    <div className="pb-auth-card">
      <p className="pb-kicker">{mode === 'signin' ? 'Welcome back' : 'Get started'}</p>
      <h1>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>

      <form onSubmit={submit} className="pb-auth-form">
        <label className="pb-auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="pb-auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button type="submit" className="pb-btn pb-btn-primary" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Sign in →' : 'Create account →'}
        </button>
      </form>

      <div className="pb-auth-alt">
        <button type="button" className="pb-linkbtn" onClick={magicLink} disabled={busy}>
          Email me a magic link instead
        </button>
        <button
          type="button"
          className="pb-linkbtn"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setMsg(null);
          }}
        >
          {mode === 'signin' ? "No account? Create one" : 'Have an account? Sign in'}
        </button>
      </div>

      {msg ? (
        <p className="pb-auth-msg" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
