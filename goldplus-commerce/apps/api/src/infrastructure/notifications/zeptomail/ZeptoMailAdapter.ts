import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from '../../../application/ports/INotificationProvider';
import { renderEmail } from './emailTemplates';

const ZEPTOMAIL_ENDPOINT = 'https://api.zeptomail.com/v1.1/email';
const REQUEST_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Sends transactional email through the ZeptoMail HTTP API.
 *
 * Behaviour contract (see AGENTS.md "no fake integrations"):
 * - Missing credentials  -> NOT_CONFIGURED, nothing is sent.
 * - 2xx from ZeptoMail   -> SENT with the provider request id.
 * - Anything else        -> FAILED with the provider's error message,
 *   which the outbox processor retries with backoff.
 */
export class ZeptoMailAdapter implements INotificationProvider {
  constructor(private readonly fetchFn: FetchLike = (input, init) => fetch(input, init)) {}

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    const token = (process.env.ZEPTOMAIL_API_TOKEN || '').trim();
    const fromAddr = (process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim();
    const fromName = (process.env.ZEPTOMAIL_FROM_NAME || 'GoldPlus').trim();

    if (!token || !fromAddr) {
      return {
        status: 'NOT_CONFIGURED',
        providerCode: 'NO_CREDENTIALS',
        providerMessage: 'ZEPTOMAIL_API_TOKEN or ZEPTOMAIL_FROM_ADDRESS is missing in environment.',
      };
    }

    const recipient = (payload.recipient || '').trim();
    if (!recipient || !recipient.includes('@')) {
      return {
        status: 'FAILED',
        providerCode: 'BAD_RECIPIENT',
        providerMessage: `Recipient "${payload.recipient}" is not a valid email address.`,
      };
    }

    const rendered = renderEmail(payload.template, payload.data);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.fetchFn(ZEPTOMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: token.startsWith('Zoho-enczapikey') ? token : `Zoho-enczapikey ${token}`,
        },
        body: JSON.stringify({
          from: { address: fromAddr, name: fromName },
          to: [{ email_address: { address: recipient } }],
          subject: rendered.subject,
          htmlbody: rendered.htmlBody,
        }),
        signal: controller.signal,
      });

      let body: any = null;
      try {
        body = await response.json();
      } catch {
        // Non-JSON body; status code alone decides the outcome.
      }

      if (response.ok) {
        return {
          status: 'SENT',
          providerCode: body?.request_id ? String(body.request_id) : String(response.status),
          providerMessage: body?.message ? String(body.message) : 'Accepted by ZeptoMail.',
        };
      }

      const errorDetail =
        body?.error?.details?.[0]?.message || body?.error?.message || body?.message || response.statusText;
      return {
        status: 'FAILED',
        providerCode: body?.error?.code ? String(body.error.code) : `HTTP_${response.status}`,
        providerMessage: `ZeptoMail rejected the send: ${errorDetail}`,
      };
    } catch (err: any) {
      const timedOut = err?.name === 'AbortError';
      return {
        status: 'FAILED',
        providerCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        providerMessage: timedOut
          ? `ZeptoMail request timed out after ${REQUEST_TIMEOUT_MS}ms.`
          : `ZeptoMail request failed: ${err?.message || 'unknown network error'}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
