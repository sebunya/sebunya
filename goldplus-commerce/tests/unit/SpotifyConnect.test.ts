import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpotifyConnectUseCases } from '../../apps/api/src/application/use-cases/advertising/SpotifyConnectUseCases';
import { HttpSpotifyAdsGateway, SPOTIFY_TOKEN_URL, SPOTIFY_ADS_API } from '../../apps/api/src/infrastructure/advertising/HttpSpotifyAdsGateway';
import { pkcePair, spotifyAuthoriseUrl, sameState, SPOTIFY_REDIRECT_PATH } from '../../apps/web/src/lib/spotifyConnect';
import { capabilityDef } from '../../apps/api/src/application/use-cases/advertising/AdCapabilities';

const root = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const CLIENT = '62eb44e920074aad9d7cdfac6fbe8667';
const ACCOUNT = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const REDIRECT = 'https://shopgoldplus.com/admin/advertising/spotify/callback';
const VERIFIER = 'a'.repeat(64);

function harness(gw: Partial<{ exchange: any; account: any }> = {}) {
  const audits: any[] = []; const saved: string[] = [];
  const uc = new SpotifyConnectUseCases(
    {
      exchangeCode: gw.exchange ?? (async () => ({ ok: true, accessToken: 'at', refreshToken: 'rt-0123456789-abcdefghij' })),
      readAdAccount: gw.account ?? (async () => ({ ok: true, name: 'Goldplus' })),
    },
    async () => ({ clientId: CLIENT, adAccountId: ACCOUNT }),
    async (_a, t) => { saved.push(t); return { ok: true }; },
    { execute: async (x: any) => { audits.push(x); return {} as any; } },
  );
  return { uc, audits, saved };
}

describe('Connect Spotify: PKCE, no client secret, and nothing saved unless it reads our ad account', () => {
  it('stores the refresh token only after the new token reads the configured ad account', async () => {
    const { uc, saved, audits } = harness();
    expect(await uc.connect('u1', { code: 'AQBcode_1234567890', codeVerifier: VERIFIER, redirectUri: REDIRECT }))
      .toEqual({ ok: true, adAccountId: ACCOUNT, adAccountName: 'Goldplus' });
    expect(saved).toEqual(['rt-0123456789-abcdefghij']);
    expect(audits.at(-1)).toMatchObject({ action: 'AD_SPOTIFY_CONNECTED', entityId: 'spotify:ads_api' });
    expect(JSON.stringify(audits)).not.toContain('rt-0123456789');
  });

  it('a sign-in that cannot see our ad account saves nothing', async () => {
    const { uc, saved, audits } = harness({ account: async () => ({ ok: false, status: 403, message: 'Spotify would not show ad account x to this sign-in (HTTP 403: forbidden).' }) });
    const r = await uc.connect('u1', { code: 'AQBcode_1234567890', codeVerifier: VERIFIER, redirectUri: REDIRECT });
    expect(r.ok).toBe(false);
    expect((r as any).message).toContain('Nothing was saved');
    expect(saved).toEqual([]);
    expect(audits.at(-1)).toMatchObject({ action: 'AD_SPOTIFY_CONNECT_FAILED' });
  });

  it('a refused code saves nothing; a missing code, verifier or wrong return address is refused before calling Spotify', async () => {
    let called = 0;
    const { uc, saved } = harness({ exchange: async () => { called++; return { ok: false, message: 'Spotify refused the sign-in code (HTTP 400: invalid_grant).' }; } });
    expect((await uc.connect('u', { code: 'AQBcode_1234567890', codeVerifier: VERIFIER, redirectUri: REDIRECT })).ok).toBe(false);
    expect(called).toBe(1);
    for (const bad of [{ code: '', codeVerifier: VERIFIER, redirectUri: REDIRECT }, { code: 'AQBcode_1234567890', codeVerifier: 'short', redirectUri: REDIRECT }, { code: 'AQBcode_1234567890', codeVerifier: VERIFIER, redirectUri: 'https://evil.example/x' }]) {
      expect((await uc.connect('u', bad)).ok).toBe(false);
    }
    expect(called).toBe(1);
    expect(saved).toEqual([]);
  });
});

describe('the HTTP gateway speaks Spotify\'s documented shapes', () => {
  it('token exchange: form-encoded authorization_code with client_id and code_verifier, never a client secret', async () => {
    let seen: any;
    const gw = new HttpSpotifyAdsGateway((async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', token_type: 'Bearer', expires_in: 3600 })); }) as any);
    const r = await gw.exchangeCode({ clientId: CLIENT, code: 'c', codeVerifier: VERIFIER, redirectUri: REDIRECT });
    expect(r).toEqual({ ok: true, accessToken: 'A', refreshToken: 'R' });
    expect(seen.url).toBe(SPOTIFY_TOKEN_URL);
    const body = new URLSearchParams(seen.init.body);
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'authorization_code', code: 'c', redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: VERIFIER });
    expect(seen.init.body).not.toMatch(/secret/);
  });

  it('a refusal carries Spotify\'s short error code and no token or code', async () => {
    const gw = new HttpSpotifyAdsGateway((async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid authorization code AQBsecretcode' }), { status: 400 })) as any);
    const r = await gw.exchangeCode({ clientId: CLIENT, code: 'AQBsecretcode', codeVerifier: VERIFIER, redirectUri: REDIRECT }) as any;
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(r.message).toContain('invalid_grant');
    expect(r.message).not.toContain('AQBsecretcode');
  });

  it('reads the ad account at api-partner.spotify.com/ads/v3 with the bearer token', async () => {
    let seen: any;
    const gw = new HttpSpotifyAdsGateway((async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ id: ACCOUNT, name: 'Goldplus' })); }) as any);
    expect(await gw.readAdAccount('AT', ACCOUNT)).toEqual({ ok: true, name: 'Goldplus' });
    expect(seen.url).toBe(`${SPOTIFY_ADS_API}/ad_accounts/${ACCOUNT}`);
    expect(seen.init.headers.Authorization).toBe('Bearer AT');
  });
});

describe('the browser half', () => {
  it('PKCE: a 64-char verifier and its S256 challenge (RFC 7636)', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    // RFC 7636 appendix B test vector
    expect(createHash('sha256').update('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').digest('base64url')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('the authorise URL is Spotify\'s, with S256, state and the exact registered redirect', () => {
    const u = new URL(spotifyAuthoriseUrl(CLIENT, 'chal', 'state-0123456789abcdef', 'https://shopgoldplus.com'));
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: CLIENT, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: 'chal', state: 'state-0123456789abcdef' });
    expect(SPOTIFY_REDIRECT_PATH).toBe('/admin/advertising/spotify/callback');
  });

  it('state must match exactly and be long; the callback strips the code from the address', () => {
    expect(sameState('x'.repeat(32), 'x'.repeat(32))).toBe(true);
    expect(sameState('x'.repeat(32), 'y'.repeat(32))).toBe(false);
    expect(sameState('', '')).toBe(false);
    const cb = read('apps/web/src/pages/admin/advertising/spotify/callback.astro');
    expect(cb).toContain('return Astro.redirect(SPOTIFY_REDIRECT_PATH, 303)');
    expect(cb).toContain('"Referrer-Policy", "no-referrer"');
  });
});

describe('the spotify:ads_api capability and migration 0171', () => {
  it('asks for the client ID and ad account only; the token comes from Connect Spotify', () => {
    const d = capabilityDef('spotify', 'ads_api')!;
    expect(d.fields.map((f) => f.key)).toEqual(['clientId', 'adAccountId']);
    expect(d.fields[0].pattern.test(CLIENT)).toBe(true);
    expect(d.secretWhere).toContain('/admin/advertising/spotify/connect');
  });
  it('0171 widens the capability check to ads_api and is registered', () => {
    expect(read('apps/api/src/infrastructure/db/migrations/0171_spotify_ads_api_capability.sql')).toContain("'whatsapp_ads', 'ads_api'");
    expect(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json')).toContain('"tag": "0171_spotify_ads_api_capability"');
  });
});
