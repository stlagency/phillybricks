/**
 * ZeptoMail (Zoho) transactional send (M7, PRD §7). The ONLY email path in Bandbox.
 *
 * HARD RULE (Aaron): EVERY send sets `track_opens: true` + `track_clicks: true`.
 * They are baked into the payload here with NO per-call opt-out — a caller cannot
 * send an untracked email, by construction. See memory [[bandbox-email-tracking]].
 *
 * Raw HTTPS POST to https://api.zeptomail.com/v1.1/email with
 * `Authorization: Zoho-enczapikey <token>`. The sender + fetch are injected so the
 * digest pipeline is unit-testable with no network and no real token.
 */

/** One recipient. */
export interface EmailRecipient {
  address: string;
  name?: string;
}

/** A single message to send. */
export interface SendEmailArgs {
  to: EmailRecipient[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  /** One-click unsubscribe URL → List-Unsubscribe headers (CAN-SPAM). */
  unsubscribeUrl?: string;
}

/** The result of a send attempt (never throws on a non-2xx — reports it). */
export interface SendResult {
  ok: boolean;
  status: number;
  id?: string;
  error?: string;
}

/** The injectable send seam the alerts pipeline depends on. */
export interface EmailSender {
  send(args: SendEmailArgs): Promise<SendResult>;
}

const ZEPTO_ENDPOINT = 'https://api.zeptomail.com/v1.1/email';

export interface ZeptoMailOptions {
  token: string;
  from: EmailRecipient;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Parse a `"Name <addr@host>"` (or bare `addr@host`) From string into parts.
 * Defaults the name to "Bandbox".
 */
export function parseFromAddress(from: string): EmailRecipient {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(from);
  if (m) return { name: m[1] || 'Bandbox', address: m[2]! };
  return { name: 'Bandbox', address: from.trim() };
}

/** Construct the live ZeptoMail sender. */
export function createZeptoMailSender(opts: ZeptoMailOptions): EmailSender {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return {
    async send(args) {
      const payload: Record<string, unknown> = {
        from: { address: opts.from.address, name: opts.from.name ?? 'Bandbox' },
        to: args.to.map((r) => ({
          email_address: { address: r.address, name: r.name ?? r.address },
        })),
        subject: args.subject,
        htmlbody: args.htmlBody,
        // ── HARD RULE: open + click tracking on EVERY send. No opt-out. ──
        track_opens: true,
        track_clicks: true,
      };
      if (args.textBody) payload.textbody = args.textBody;
      if (args.unsubscribeUrl) {
        // ZeptoMail carries custom headers under `mime_headers` (object form).
        payload.mime_headers = {
          'List-Unsubscribe': `<${args.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(ZEPTO_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Zoho-enczapikey ${opts.token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        let id: string | undefined;
        try {
          const json = (await res.json()) as {
            data?: { message_id?: string }[];
            request_id?: string;
          };
          id = json?.data?.[0]?.message_id ?? json?.request_id;
        } catch {
          /* body is optional for our purposes */
        }
        return { ok: res.ok, status: res.status, id };
      } catch (err) {
        const error = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'send_failed';
        return { ok: false, status: 0, error };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
