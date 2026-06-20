/**
 * ZeptoMail sender (M7). The load-bearing assertion is the HARD RULE: every send
 * carries track_opens + track_clicks = true — there is no opt-out path.
 */
import { describe, it, expect } from 'vitest';
import { createZeptoMailSender, parseFromAddress } from '../src/email.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createZeptoMailSender', () => {
  it('sets track_opens + track_clicks on EVERY send (HARD RULE)', async () => {
    let captured: { url: unknown; init: RequestInit } | null = null;
    const fetchImpl = (async (url: unknown, init: RequestInit) => {
      captured = { url, init };
      return jsonResponse({ data: [{ message_id: 'm1' }] });
    }) as unknown as typeof fetch;

    const sender = createZeptoMailSender({
      token: 'TKN',
      from: { address: 'alerts@bandbox.pro', name: 'Bandbox' },
      fetchImpl,
    });
    const res = await sender.send({
      to: [{ address: 'a@b.com' }],
      subject: 'Hi',
      htmlBody: '<p>x</p>',
      unsubscribeUrl: 'https://www.bandbox.pro/api/unsubscribe?token=t',
    });

    expect(res.ok).toBe(true);
    expect(res.id).toBe('m1');
    expect(captured!.url).toBe('https://api.zeptomail.com/v1.1/email');

    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Zoho-enczapikey TKN');

    const body = JSON.parse(captured!.init.body as string);
    expect(body.track_opens).toBe(true);
    expect(body.track_clicks).toBe(true);
    expect(body.mime_headers['List-Unsubscribe']).toContain('token=t');
    expect(body.mime_headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('reports a non-2xx without throwing', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'nope' }, 401)) as unknown as typeof fetch;
    const sender = createZeptoMailSender({ token: 't', from: { address: 'a@b' }, fetchImpl });
    const res = await sender.send({ to: [{ address: 'x@y' }], subject: 's', htmlBody: 'h' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it('parseFromAddress handles "Name <addr>" and a bare address', () => {
    expect(parseFromAddress('Bandbox <alerts@bandbox.pro>')).toEqual({
      name: 'Bandbox',
      address: 'alerts@bandbox.pro',
    });
    expect(parseFromAddress('noreply@bandbox.pro')).toEqual({
      name: 'Bandbox',
      address: 'noreply@bandbox.pro',
    });
  });
});
