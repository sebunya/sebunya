import type { SpotifyAdsGateway, SpotifyResult } from '../../application/ports/SpotifyAdsApi';

/**
 * Spotify OAuth and Ads API over HTTP. Endpoints and request shapes from
 * Spotify's own tooling (spotify/ads-agentic-tools: configure/scripts/
 * oauth-flow.py and scripts/api-request.sh). Never logs or returns a token or
 * code; errors carry Spotify's short error code only.
 */
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_ADS_API = 'https://api-partner.spotify.com/ads/v3';

const shortError = (body: string): string => {
  try {
    const j = JSON.parse(body) as { error?: unknown; error_description?: unknown; message?: unknown };
    const code = typeof j.error === 'string' ? j.error : typeof j.message === 'string' ? j.message : '';
    return /^[A-Za-z0-9_ .:-]{1,120}$/.test(code) ? code : 'rejected';
  } catch { return 'rejected'; }
};

export class HttpSpotifyAdsGateway implements SpotifyAdsGateway {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async exchangeCode(input: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<SpotifyResult<{ accessToken: string; refreshToken: string }>> {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, client_id: input.clientId, code_verifier: input.codeVerifier });
    const res = await this.fetchImpl(SPOTIFY_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, message: `Spotify refused the sign-in code (HTTP ${res.status}: ${shortError(text)}).` };
    let j: { access_token?: unknown; refresh_token?: unknown } = {};
    try { j = JSON.parse(text); } catch { /* handled below */ }
    if (typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string') return { ok: false, message: 'Spotify answered without the tokens it should send.' };
    return { ok: true, accessToken: j.access_token, refreshToken: j.refresh_token };
  }

  async readAdAccount(accessToken: string, adAccountId: string): Promise<SpotifyResult<{ name: string | null }>> {
    const res = await this.fetchImpl(`${SPOTIFY_ADS_API}/ad_accounts/${encodeURIComponent(adAccountId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, message: `Spotify would not show ad account ${adAccountId} to this sign-in (HTTP ${res.status}: ${shortError(text)}).` };
    let name: string | null = null;
    try { const j = JSON.parse(text) as { name?: unknown }; name = typeof j.name === 'string' ? j.name.slice(0, 120) : null; } catch { /* name stays null */ }
    return { ok: true, name };
  }
}
