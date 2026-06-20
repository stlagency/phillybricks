/**
 * GET /api/unsubscribe?token=… — one-click email unsubscribe (CAN-SPAM, PRD §7).
 * NO login: the opaque unsub_token IS the credential. Resolving it switches the
 * subscription's channel to 'in_app' (email stops; the in-app feed continues), and
 * returns a small HTML confirmation. Unknown/blank token → a neutral page (no
 * enumeration signal). Also handles POST so List-Unsubscribe-Post one-click works.
 */
import { db } from '../../../lib/db';

export const dynamic = 'force-dynamic';

function page(message: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bandbox — Unsubscribe</title>
<style>body{font-family:system-ui,sans-serif;background:#0A2A5E;color:#fff;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:30rem;padding:2rem;text-align:center;line-height:1.5}
a{color:#FFD166}</style></head>
<body><div class="card"><h1>Bandbox</h1><p>${message}</p>
<p><a href="https://www.bandbox.pro">Back to Bandbox →</a></p></div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handle(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token')?.trim() ?? '';
  if (!token) return page('No unsubscribe token supplied.');

  const rows = await db()<{ id: string }[]>`
    update app.alert_subscription set channel = 'in_app'
    where unsub_token = ${token}
    returning id`;
  // Neutral copy whether or not the token matched (no account enumeration).
  return page(
    rows.length > 0
      ? 'You have been unsubscribed from these email alerts. They will still appear in your in-app feed.'
      : 'This unsubscribe link is no longer active.',
  );
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
