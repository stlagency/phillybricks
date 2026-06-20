/**
 * Ops runner for the M7 alert digests (PRD §3.5/§7). Same code the nightly calls
 * (run.ts main), runnable on demand. Email is opt-in on ZEPTOMAIL_TOKEN; without it
 * only the in-app feed is written. Every ZeptoMail send is open+click-tracked by
 * construction.
 *
 *   DATABASE_URL=… [ZEPTOMAIL_TOKEN=… ZEPTOMAIL_FROM='Bandbox <noreply@bandbox.pro>'] \
 *     pnpm --filter @bandbox/ingestion exec tsx scripts/run-alerts.ts
 */
import { connectFromEnv, asDbClient } from '../src/db.js';
import { runAlerts } from '../src/alerts.js';
import { createZeptoMailSender, parseFromAddress } from '../src/email.js';

async function main(): Promise<void> {
  const sql = connectFromEnv();
  const db = asDbClient(sql);
  try {
    const token = process.env.ZEPTOMAIL_TOKEN;
    const from = parseFromAddress(process.env.ZEPTOMAIL_FROM ?? 'Bandbox <alerts@bandbox.pro>');
    const sender = token ? createZeptoMailSender({ token, from }) : null;
    const rep = await runAlerts(db, {
      send: sender,
      baseUrl: process.env.PUBLIC_BASE_URL ?? 'https://www.bandbox.pro',
      log: (m) => console.log(`  ${m}`),
    });
    console.log(
      `Alerts: ${rep.subscriptionsProcessed} subscription(s), ${rep.eventsInserted} feed event(s), ` +
        `${rep.emailsSent} email(s)${sender ? '' : ' (email disabled — ZEPTOMAIL_TOKEN unset)'}.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('run-alerts failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
