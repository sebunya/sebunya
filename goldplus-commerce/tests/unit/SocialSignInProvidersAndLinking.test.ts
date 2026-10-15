import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OIDC_PROVIDERS,
  buildAuthorizationUrl,
  tokenRequest,
} from '../../apps/api/src/infrastructure/identity/OidcProviders';
import { META_GRAPH_VERSION } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import { LinkSocialIdentityUseCase } from '../../apps/api/src/application/use-cases/identity/LinkSocialIdentityUseCase';
import { ListSignInMethodsUseCase, RemoveSignInMethodUseCase } from '../../apps/api/src/application/use-cases/identity/SignInMethodsUseCases';
import { socialSignInMessage } from '../../apps/web/src/lib/socialSignInMessages';

/**
 * Social sign-in, made ready for the day Google, Apple and Facebook are switched on (2026-10-15).
 *
 * - Apple documents no PKCE and advertises none: its flow sends no challenge or verifier.
 * - Facebook's OIDC code flow requires PKCE and documents the exchange as a GET, on the shop's pinned Graph version
 *   (the code named v18.0, long retired).
 * - The login page showed nothing when a social sign-in was refused; every code now has a sentence.
 * - "Connect it from your account settings" pointed at nothing: Account → Sign-in methods now connects and removes.
 */

const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const creds = { clientId: 'client-id', clientSecret: 'secret' };
const auth = (provider: 'google' | 'apple' | 'facebook') =>
  new URL(buildAuthorizationUrl({ provider, clientId: 'client-id', redirectUri: 'https://x/cb', state: 's', nonce: 'n', codeChallenge: 'chal' }));
const exchange = (provider: 'google' | 'apple' | 'facebook') =>
  tokenRequest({ provider, code: 'code', redirectUri: 'https://x/cb', codeVerifier: 'verifier', credentials: creds });

describe('each provider is asked the way it documents', () => {
  it('Apple: no PKCE in either half, form_post kept, state and nonce kept', () => {
    const url = auth('apple');
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('code_challenge_method')).toBe(false);
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.get('nonce')).toBe('n');
    const req = exchange('apple');
    expect(req.init.method).toBe('POST');
    expect(req.init.body?.has('code_verifier')).toBe(false);
    expect(req.init.body?.get('client_secret')).toBe('secret');
  });

  it('Google: PKCE S256 on the authorize URL and the verifier on the POST exchange', () => {
    const url = auth('google');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const req = exchange('google');
    expect(req.init.method).toBe('POST');
    expect(req.init.body?.get('code_verifier')).toBe('verifier');
  });

  it('Facebook: PKCE, a GET exchange with the verifier in the query, on the pinned Graph version', () => {
    const url = auth('facebook');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('nonce')).toBe('n');
    const req = exchange('facebook');
    expect(req.init.method).toBe('GET');
    expect(req.init.body).toBeUndefined();
    const u = new URL(req.url);
    expect(u.searchParams.get('code_verifier')).toBe('verifier');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x/cb');
    expect(OIDC_PROVIDERS.facebook.authorizationEndpoint).toBe(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    expect(OIDC_PROVIDERS.facebook.tokenEndpoint).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
    expect(read('apps/api/src/infrastructure/identity/OidcProviders.ts')).not.toContain('v18.0');
  });
});

/* ── connecting and removing ─────────────────────────────────────────────── */

const fakeUsers = (users: any[]) => ({ async findById(id: string) { return users.find((u) => u.id === id) ?? null; } });
const fakeIdentities = (seed: any[] = [], unlinkResult = { ok: true }) => {
  const rows = [...seed];
  const linked: any[] = [];
  const unlinked: string[] = [];
  return {
    rows, linked, unlinked,
    async findByProviderSubject(provider: string, subject: string) { return rows.find((r) => r.provider === provider && r.subject === subject) ?? null; },
    async listForUser(userId: string) { return rows.filter((r) => r.userId === userId); },
    async link(input: any) { linked.push(input); const row = { id: `id-${rows.length + 1}`, ...input }; rows.push(row); return row; },
    async unlink(userId: string, provider: string) { if (unlinkResult.ok) unlinked.push(`${userId}:${provider}`); return unlinkResult; },
  };
};
const me = { id: 'u-me', email: 'me@example.com', isActive: true, passwordHash: 'h' };
const other = { id: 'u-other', email: 'other@example.com', isActive: true, passwordHash: 'h' };
const connect = (identities: any, users = [me, other], subject = 'fb-1') =>
  new LinkSocialIdentityUseCase(fakeUsers(users) as never, identities as never).execute({
    userId: 'u-me', provider: 'facebook', subject, email: 'Me@Example.com', emailVerified: false, providerName: 'Facebook',
  });

describe('Account → Sign-in methods: connecting a provider', () => {
  it('connects a provider identity nobody has, without touching the password', async () => {
    const ids = fakeIdentities();
    expect(await connect(ids)).toEqual({ ok: true, alreadyLinked: false });
    expect(ids.linked).toEqual([{ userId: 'u-me', provider: 'facebook', subject: 'fb-1', email: 'me@example.com', emailVerified: false }]);
    expect(ids.linked[0].revokePasswordAccess).toBeUndefined();
  });

  it('an identity that signs in to ANOTHER account is refused and nothing is written', async () => {
    const ids = fakeIdentities([{ id: 'i1', userId: 'u-other', provider: 'facebook', subject: 'fb-1' }]);
    expect(await connect(ids)).toMatchObject({ ok: false, code: 'IDENTITY_IN_USE' });
    expect(ids.linked).toHaveLength(0);
  });

  it('connecting the same identity again is a no-op success', async () => {
    const ids = fakeIdentities([{ id: 'i1', userId: 'u-me', provider: 'facebook', subject: 'fb-1' }]);
    expect(await connect(ids)).toEqual({ ok: true, alreadyLinked: true });
    expect(ids.linked).toHaveLength(0);
  });

  it('a second account from the same provider is refused until the first is removed', async () => {
    const ids = fakeIdentities([{ id: 'i1', userId: 'u-me', provider: 'facebook', subject: 'fb-OLD' }]);
    expect(await connect(ids)).toMatchObject({ ok: false, code: 'PROVIDER_ALREADY_LINKED' });
    expect(ids.linked).toHaveLength(0);
  });

  it('a disabled account connects nothing', async () => {
    const ids = fakeIdentities();
    expect(await connect(ids, [{ ...me, isActive: false }])).toMatchObject({ ok: false, code: 'ACCOUNT_DISABLED' });
    expect(ids.linked).toHaveLength(0);
  });
});

describe('Account → Sign-in methods: listing and removing', () => {
  it('lists every provider with whether it is configured and connected, and whether a password is set', async () => {
    const ids = fakeIdentities([{ id: 'i1', userId: 'u-me', provider: 'google', subject: 'g', email: 'me@gmail.com' }]);
    const out = await new ListSignInMethodsUseCase(fakeUsers([{ ...me, passwordHash: null }]) as never, ids as never).execute({
      userId: 'u-me',
      providers: [
        { provider: 'google', displayName: 'Google', configured: true },
        { provider: 'apple', displayName: 'Apple', configured: false },
        { provider: 'facebook', displayName: 'Facebook', configured: true },
      ],
    });
    expect(out.hasPassword).toBe(false);
    expect(out.methods).toEqual([
      { provider: 'google', displayName: 'Google', configured: true, connected: true, email: 'me@gmail.com' },
      { provider: 'apple', displayName: 'Apple', configured: false, connected: false, email: null },
      { provider: 'facebook', displayName: 'Facebook', configured: true, connected: false, email: null },
    ]);
  });

  it('removes a connected provider', async () => {
    const ids = fakeIdentities([{ id: 'i1', userId: 'u-me', provider: 'google', subject: 'g' }]);
    expect(await new RemoveSignInMethodUseCase(ids as never).execute({ userId: 'u-me', provider: 'google', providerName: 'Google' })).toEqual({ ok: true });
    expect(ids.unlinked).toEqual(['u-me:google']);
  });

  it('refuses to remove the last way in, and says how to add another', async () => {
    const ids = fakeIdentities([{ id: 'i1', userId: 'u-me', provider: 'google', subject: 'g' }], { ok: false });
    const out = await new RemoveSignInMethodUseCase(ids as never).execute({ userId: 'u-me', provider: 'google', providerName: 'Google' });
    expect(out).toMatchObject({ ok: false, code: 'LAST_SIGN_IN_METHOD' });
    expect((out as { message: string }).message).toMatch(/Set a password first/);
  });

  it('a provider that is not connected is not "removed"', async () => {
    const ids = fakeIdentities();
    expect(await new RemoveSignInMethodUseCase(ids as never).execute({ userId: 'u-me', provider: 'apple', providerName: 'Apple' }))
      .toMatchObject({ ok: false, code: 'NOT_CONNECTED' });
    expect(ids.unlinked).toHaveLength(0);
  });
});

/* ── the routes ──────────────────────────────────────────────────────────── */

describe('the social routes', { timeout: 60_000 }, () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-for-flow-sealing-0123456789';
    process.env.GOOGLE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.APPLE_CLIENT_ID = 'com.shopgoldplus.web';
    process.env.APPLE_TEAM_ID = 'TEAM123456';
    process.env.APPLE_KEY_ID = 'KEY1234567';
    process.env.APPLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  });
  afterEach(() => { process.env = { ...saved }; });

  const routes = async () => (await import('../../apps/api/src/interfaces/http/routes/auth-social')).default;
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
    (await routes()).request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('starting a CONNECT without a signed-in session is refused (401) and mints no flow', async () => {
    const res = await post('/google/authorize-url', { intent: 'link' });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.data).toBeUndefined();
  });

  it('a plain sign-in start still works, with PKCE for Google and none for Apple', async () => {
    const g = await (await post('/google/authorize-url', {})).json();
    expect(new URL(g.data.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
    const a = await (await post('/apple/authorize-url', {})).json();
    const appleUrl = new URL(a.data.authorizationUrl);
    expect(appleUrl.searchParams.has('code_challenge')).toBe(false);
    expect(appleUrl.searchParams.get('redirect_uri')).toBe('https://api.shopgoldplus.com/auth/social/apple/form-post');
  });

  it('a CONNECT flow finished without its session is refused before the provider is called', async () => {
    delete process.env.CART_CREDENTIAL_SECRET;
    const { createHmac } = await import('node:crypto');
    const flow = { provider: 'google', state: 'st', nonce: 'n', verifier: 'v', issuedAt: Date.now(), linkUserId: 'u-started-it' };
    const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
    const sealedFlow = `${payload}.${createHmac('sha256', process.env.JWT_SECRET as string).update(payload).digest('base64url')}`;
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => { calls.push(String(url)); throw new Error('provider must not be called'); }) as typeof fetch;
    try {
      const res = await post('/google/exchange', { code: 'c', state: 'st', sealedFlow });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('LINK_SESSION_MISMATCH');
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

/* ── what the customer reads ─────────────────────────────────────────────── */

describe('every refusal reads as a sentence on the login and sign-in methods pages', () => {
  const codes = [
    'cancelled', 'state', 'not_configured', 'start', 'exchange', // web routes
    'state_mismatch', 'no_code', 'exchange_failed', 'token_rejected', 'account_missing', 'link_session_mismatch', // API exchange
    'no_email_from_provider', 'manual_link_required', 'account_disabled', // ResolveSocialIdentityUseCase
    'identity_in_use', 'provider_already_linked', 'unauthenticated', // connect
  ];
  const general = socialSignInMessage('something_new');

  it.each(codes)('%s has its own message', (code) => {
    const text = socialSignInMessage(code);
    expect(text).toBeTruthy();
    expect(text).not.toBe(general);
  });

  it('an unknown code gets the general line, never the raw code; no code, no message', () => {
    expect(general).not.toContain('something_new');
    expect(socialSignInMessage(null)).toBeNull();
    expect(socialSignInMessage('')).toBeNull();
  });

  it('the login page and the sign-in methods page both show it', () => {
    expect(read('apps/web/src/pages/login.astro')).toMatch(/socialSignInMessage\(Astro\.url\.searchParams\.get\('social_error'\)\)/);
    expect(read('apps/web/src/pages/account/sign-in.astro')).toMatch(/socialSignInMessage\(Astro\.url\.searchParams\.get\('social_error'\)\)/);
  });

  it('the refusals point at a page that exists', () => {
    const resolve = read('apps/api/src/application/use-cases/identity/ResolveSocialIdentityUseCase.ts');
    expect(resolve).not.toMatch(/from your account settings/);
    expect(resolve).toMatch(/Account, Sign-in methods/);
    expect(read('apps/web/src/components/AccountNav.astro')).toContain("href: '/account/sign-in', label: 'Sign-in methods'");
  });
});
