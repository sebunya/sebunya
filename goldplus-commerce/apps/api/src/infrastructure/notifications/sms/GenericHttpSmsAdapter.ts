import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from '../../../application/ports/INotificationProvider';

const REQUEST_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Sends SMS via a generic HTTP gateway (works with most Ugandan/African
 * bulk-SMS providers that accept a JSON POST with an API key). Configured
 * entirely by environment so no provider is hard-coded:
 *
 *   SMS_API_URL    - gateway endpoint
 *   SMS_API_KEY    - bearer token / api key
 *   SMS_SENDER_ID  - optional alphanumeric sender id
 *
 * "No fake integrations": missing config -> NOT_CONFIGURED, nothing sent.
 * The message text is passed via payload.data.message (set by the OTP /
 * notification layer).
 */
export class GenericHttpSmsAdapter implements INotificationProvider {
  constructor(private readonly fetchFn: FetchLike = (input, init) => fetch(input, init)) {}

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    const url = (process.env.SMS_API_URL || '').trim();
    const apiKey = (process.env.SMS_API_KEY || '').trim();
    const senderId = (process.env.SMS_SENDER_ID || 'GoldPlus').trim();

    if (!url || !apiKey) {
      return {
        status: 'NOT_CONFIGURED',
        providerCode: 'NO_CREDENTIALS',
        providerMessage: 'SMS_API_URL or SMS_API_KEY is missing in environment.',
      };
    }

    const recipient = (payload.recipient || '').replace(/\s+/g, '');
    if (!/^\+?[0-9]{9,15}$/.test(recipient)) {
      return { status: 'FAILED', providerCode: 'BAD_RECIPIENT', providerMessage: `Invalid SMS recipient "${payload.recipient}".` };
    }

    const message = String((payload.data as any)?.message ?? '').trim();
    if (!message) {
      return { status: 'FAILED', providerCode: 'EMPTY_MESSAGE', providerMessage: 'No SMS message body was provided.' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ to: recipient, from: senderId, message }),
        signal: controller.signal,
      });

      let body: any = null;
      try {
        body = await response.json();
      } catch {
        /* status code decides */
      }

      if (response.ok) {
        return {
          status: 'SENT',
          providerCode: body?.id ? String(body.id) : String(response.status),
          providerMessage: body?.message ? String(body.message) : 'Accepted by SMS gateway.',
        };
      }
      return {
        status: 'FAILED',
        providerCode: body?.code ? String(body.code) : `HTTP_${response.status}`,
        providerMessage: `SMS gateway rejected the send: ${body?.message ?? response.statusText}`,
      };
    } catch (err: any) {
      const timedOut = err?.name === 'AbortError';
      return {
        status: 'FAILED',
        providerCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        providerMessage: timedOut ? 'SMS gateway request timed out.' : `SMS request failed: ${err?.message ?? 'unknown'}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
