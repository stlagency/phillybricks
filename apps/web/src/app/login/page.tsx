/**
 * Route "/login" — sign in / create account (M7). Server shell + TopBand; the
 * interactive form is the client <LoginForm>. force-dynamic (nothing cacheable).
 */
import type { Metadata } from 'next';
import { TopBand } from '../../components/TopBand';
import { LoginForm } from './LoginForm';
import '../account/account.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in — Bandbox',
  description: 'Sign in to save areas, get alerts, export leads, and run skip-trace.',
};

export default function Page() {
  return (
    <div className="pb-app">
      <TopBand current="Sign in" />
      <main className="pb-auth-main">
        <LoginForm />
      </main>
    </div>
  );
}
