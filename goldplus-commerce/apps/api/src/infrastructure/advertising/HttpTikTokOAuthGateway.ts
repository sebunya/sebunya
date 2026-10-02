import type { TikTokOAuthGateway, TikTokTokenAnswer } from '../../application/ports/TikTokOAuth';
import { tiktokErrorSummary } from './AdPlatforms';

const TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';

/**
 * TikTok API for Business: auth code → access token (2026-10-02). The host is
 * fixed, the secret and the code travel in the request body only, and neither
 * they nor the reply are logged. A message that goes back to the admin has
 * the secret and the code removed, whatever TikTok echoed.
 */
export class HttpTikTokOAuthGateway implements TikTokOAuthGateway {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async exchange(appId: string, appSecret: string, authCode: string): Promise<TikTokTokenAnswer> {
    const scrub = (m: string) => m.split(appSecret).join('[secret]').split(authCode).join('[code]');
    let res: Response;
    try {
      res = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code: authCode }), redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      return { ok: false, message: `TikTok could not be reached (${(err as Error).name === 'TimeoutError' ? 'no answer in 10 seconds' : 'network error'}).` };
    }
    const text = await res.text().catch(() => '');
    const told = tiktokErrorSummary(res.status, text);
    if (told) return { ok: false, message: scrub(told.message) };
    if (!res.ok) return { ok: false, message: `TikTok answered HTTP ${res.status} with no explanation.` };
    let json: { code?: unknown; data?: { access_token?: unknown; advertiser_ids?: unknown } } | null = null;
    try { json = JSON.parse(text); } catch { /* handled below */ }
    const token = json && Number(json.code) === 0 && typeof json.data?.access_token === 'string' ? json.data.access_token : '';
    if (!token) return { ok: false, message: 'TikTok answered without an access token.' };
    // Read from the text, not the parsed value: an advertiser ID is 19 digits, and one
    // sent as a JSON number loses its last digits when parsed.
    const list = /"advertiser_ids"\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? '';
    const ids = (list.match(/\d{8,25}/g) ?? []);
    return { ok: true, accessToken: token, advertiserIds: ids };
  }
}
