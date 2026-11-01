import type { TikTokAnswer, TikTokDiagnosticsGateway, TikTokTestEvent } from '../../application/ports/TikTokDiagnostics';
import { buildAdRequest, tiktokErrorSummary } from './AdPlatforms';

const TEST_LABEL = 'goldplus-connection-test';

/**
 * Sends one test event to TikTok's Events API (2026-10-01). The request is
 * built by the same builder as a real event, in test mode, so what TikTok
 * validates here is what it will be sent. The host is fixed; the token goes
 * in the Access-Token header; nothing here logs a request or a response body.
 */
export class HttpTikTokDiagnosticsGateway implements TikTokDiagnosticsGateway {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async sendTestEvent(input: TikTokTestEvent): Promise<TikTokAnswer> {
    const purchase = input.kind === 'purchase';
    // No real visitor: the identifier is a fixed label (hashed by the builder) and the browser says what it is.
    const event = {
      event_name: purchase ? 'purchase' : 'view_item', event_id: input.eventId, event_time: input.eventTime, source: 'server',
      page_location: `${input.origin}${purchase ? '/checkout' : '/'}`,
      user_data: { fp_client_id: TEST_LABEL, user_agent: 'GoldPlus connection test (not a visitor)' },
      ecommerce: { value: 1000, currency: 'UGX', ...(purchase ? { transaction_id: `TEST-${input.eventId.slice(-8).toUpperCase()}` } : {}),
        items: [{ item_id: TEST_LABEL, item_name: 'Connection test', price: 1000, quantity: 1 }] },
    };
    const req = buildAdRequest('tiktok', event as never, { ...input.config, _test: '1', testEventCode: input.testEventCode }, input.token);
    if (!req) return { ok: false, message: 'The test event could not be built from the saved TikTok settings.', credentials: false, transient: false };
    let res: Response;
    try {
      res = await this.fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      return { ok: false, message: `TikTok could not be reached (${(err as Error).name === 'TimeoutError' ? 'no answer in 10 seconds' : 'network error'}).`, credentials: false, transient: true };
    }
    const text = await res.text().catch(() => '');
    const told = tiktokErrorSummary(res.status, text);
    if (told) return { ok: false, message: told.message, credentials: told.credentials, transient: told.transient };
    if (!res.ok) return { ok: false, message: `TikTok answered HTTP ${res.status} with no explanation.`, credentials: res.status === 401 || res.status === 403, transient: res.status >= 500 || res.status === 429 };
    let json: { code?: unknown; request_id?: unknown } | null = null;
    try { json = JSON.parse(text); } catch { /* handled below */ }
    // `code: 0` is the only thing TikTok calls success.
    if (!json || Number(json.code) !== 0) return { ok: false, message: 'TikTok answered with something that is not its success reply.', credentials: false, transient: true };
    const p = (req.body as { data: Array<{ properties?: { value?: number; currency?: string } }> }).data[0].properties;
    return { ok: true, requestId: typeof json.request_id === 'string' ? json.request_id : null,
      sentValue: p && typeof p.value === 'number' && p.currency ? { value: p.value, currency: p.currency } : null };
  }
}
