/**
 * Route "/account" — the signed-in user's home (M7): skip-trace attestation + BYO
 * key, saved areas, alert subscriptions, and the alert feed. Server shell + TopBand;
 * the interactive surface is the client <AccountView>. force-dynamic.
 */
import type { Metadata } from 'next';
import { TopBand } from '../../components/TopBand';
import { AccountView } from './AccountView';
import './account.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account — Bandbox',
  description: 'Manage saved areas, alerts, skip-trace, and your Bandbox account.',
};

export default function Page() {
  return (
    <div className="pb-app">
      <TopBand current="Account" />
      <main className="pb-account-main">
        <AccountView />
      </main>
    </div>
  );
}
