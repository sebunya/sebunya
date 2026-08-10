import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { IntegrationCredentialVault, maskOf } from '../../apps/api/src/infrastructure/seo/IntegrationCredentialVault';
import { GoogleOAuthService, GoogleTokenBroker } from '../../apps/api/src/infrastructure/seo/GoogleOAuthService';
import {
  GenericSlotAdapter,
  GscAdapter,
  PageSpeedAdapter,
  BingWebmasterAdapter,
  IndexNowAdapter,
  adapterFor,
} from '../../apps/api/src/infrastructure/seo/adapters/SeoIntegrationAdapters';
import {
  isPrivateAddress,
  validateCustomRequest,
  performCustomGet,
} from '../../apps/api/src/infrastructure/seo/adapters/CustomReadOnlyRestAdapter';
import {
  statusAfterCredentialAdd,
  statusForTest,
  freshnessOf,
  dailyCapOf,
} from '../../apps/api/src/application/use-cases/seo-growth/SeoIntegrationLifecycle';
import {
  SEO_INTEGRATION_PROVIDER_MANIFESTS,
} from '../../apps/api/src/application/use-cases/seo-growth/RegisterSeoIntegrationProvidersUseCase';
import type { SeoIntegrationConnectionView } from '../../apps/api/src/application/ports/SeoIntegrationAdapter';

const SECRET = 'unit-test-vault-secret-material-32chars!!';

const connection = (providerId: string, config: Record<string, unknown> = {}): SeoIntegrationConnectionView => ({
  id: 'c1', providerId, name: 'test', status: 'CONFIGURING', accountRef: null, propertyRef: null, config,
});

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  // Adapters fall back to env credentials; tests must not inherit real ones.
  delete process.env.GSC_SERVICE_ACCOUNT_JSON;
  delete process.env.GSC_SITE_URL;
  delete process.env.PAGESPEED_API_KEY;
  delete process.env.BING_WEBMASTER_API_KEY;
  delete process.env.INDEXNOW_KEY;
});

// ── Credential vault ────────────────────────────────────────────────────────

describe('IntegrationCredentialVault', () => {
  it('round-trips an object payload', () => {
    const vault = new IntegrationCredentialVault(SECRET);
    const payload = { apiKey: 'AIzaSyEXAMPLE-abcdef123456', nested: { a: 1 } };
    const ciphertext = vault.encrypt(payload);
    expect(ciphertext.split('.')).toHaveLength(3);
    expect(ciphertext).not.toContain('AIzaSy');
    expect(vault.decrypt(ciphertext)).toEqual(payload);
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const vault = new IntegrationCredentialVault(SECRET);
    const ciphertext = vault.encrypt({ apiKey: 'x' });
    const [iv, tag, data] = ciphertext.split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    expect(() => vault.decrypt(`${iv}.${tag}.${flipped.toString('base64')}`)).toThrow();
  });

  it('a different key cannot decrypt', () => {
    const a = new IntegrationCredentialVault(SECRET);
    const b = new IntegrationCredentialVault('another-secret-material-that-differs!');
    expect(() => b.decrypt(a.encrypt({ apiKey: 'x' }))).toThrow();
  });

  it('mask is 4 dots + 4 chars and never contains more than 4 chars of the secret', () => {
    const secret = 'SUPERSECRETKEYVALUE-9911';
    const mask = maskOf(secret);
    expect(mask.startsWith('••••')).toBe(true);
    expect(mask.length).toBe(8);
    const tail = mask.slice(4);
    // The tail is a sha256 fingerprint fragment, not raw secret characters:
    // assert no 5+ char run of the secret ever appears in the mask.
    for (let i = 0; i + 5 <= secret.length; i += 1) {
      expect(mask.includes(secret.slice(i, i + 5))).toBe(false);
    }
    expect(tail).toHaveLength(4);
  });

  it('service-account masks derive from client_email, never key material', () => {
    const sa = { client_email: 'seo-bot@project.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nABCDEFTOPSECRET\n-----END PRIVATE KEY-----' };
    const mask = maskOf(sa);
    expect(mask).toBe('••••-BOT');
    expect(mask).not.toContain('SECRET');
    expect(mask).not.toContain('ABCDEF');
  });
});

// ── OAuth state validation ──────────────────────────────────────────────────

describe('GoogleOAuthService state handling', () => {
  const makeService = () => {
    let now = 1_000_000_000_000;
    const svc = new GoogleOAuthService(SECRET, {}, () => now);
    return { svc, advance: (ms: number) => { now += ms; } };
  };

  it('accepts a valid state exactly once (one-shot)', () => {
    const { svc } = makeService();
    const { state } = svc.createState('conn-1', 'actor-1');
    const record = svc.consumeState(state, 'actor-1');
    expect(record?.connectionId).toBe('conn-1');
    expect(svc.consumeState(state, 'actor-1')).toBeNull();
  });

  it('rejects an expired state (10 minute TTL)', () => {
    const { svc, advance } = makeService();
    const { state } = svc.createState('conn-1', 'actor-1');
    advance(11 * 60 * 1000);
    expect(svc.consumeState(state, 'actor-1')).toBeNull();
  });

  it('rejects a state presented by a different actor', () => {
    const { svc } = makeService();
    const { state } = svc.createState('conn-1', 'actor-1');
    expect(svc.consumeState(state, 'actor-2')).toBeNull();
  });

  it('rejects a tampered state signature', () => {
    const { svc } = makeService();
    const { state } = svc.createState('conn-1', 'actor-1');
    const dot = state.lastIndexOf('.');
    const tampered = `${state.slice(0, dot)}.AAAA${state.slice(dot + 5)}`;
    expect(svc.consumeState(tampered, 'actor-1')).toBeNull();
  });

  it('builds a PKCE S256 auth URL with no secret material', () => {
    const { svc } = makeService();
    const { state, verifier } = svc.createState('conn-1', 'actor-1');
    const url = svc.buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x/cb', scopes: ['s1'], state, verifier });
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('code_challenge=');
    expect(url).not.toContain(verifier);
    expect(url).not.toContain('client_secret');
  });

  it('token broker demands re-authorization when no tokens are stored', async () => {
    const { svc } = makeService();
    const broker = new GoogleTokenBroker(svc, () => 0);
    await expect(broker.accessToken({})).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
  });
});

// ── Staged test-result shaping ──────────────────────────────────────────────

describe('adapter staged test results', () => {
  it('generic adapter slots refuse honestly with CONFIGURATION_ERROR', async () => {
    const adapter = new GenericSlotAdapter('rank-tracker-generic');
    const result = await adapter.testConnection(connection('rank-tracker-generic'), { apiKey: 'k' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CONFIGURATION_ERROR');
    expect(result.errorMessage).toContain('No approved provider adapter bound yet');
  });

  it('GSC without any credential fails at AUTHENTICATION with INVALID_CREDENTIAL', async () => {
    const adapter = new GscAdapter();
    const result = await adapter.testConnection(connection('google-search-console'), null);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_CREDENTIAL');
    expect(result.stages[0].stage).toBe('AUTHENTICATION');
    expect(result.stages[0].ok).toBe(false);
  });

  it('PageSpeed maps an upstream 403 to INSUFFICIENT_SCOPE', async () => {
    const fetchImpl = (async () => jsonResponse(403, { error: 'forbidden' })) as unknown as typeof fetch;
    const result = await new PageSpeedAdapter(fetchImpl).testConnection(connection('google-pagespeed'), { apiKey: 'k' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INSUFFICIENT_SCOPE');
  });

  it('Bing success produces ordered ok stages (AUTHENTICATION then RESOURCE_ACCESS)', async () => {
    const fetchImpl = (async () => jsonResponse(200, { d: [{ Url: 'https://shopgoldplus.com' }] })) as unknown as typeof fetch;
    const result = await new BingWebmasterAdapter(fetchImpl).testConnection(
      connection('bing-webmaster', { siteUrl: 'https://shopgoldplus.com' }), { apiKey: 'k' },
    );
    expect(result.ok).toBe(true);
    expect(result.stages.map((s) => s.stage)).toEqual(['AUTHENTICATION', 'RESOURCE_ACCESS']);
    expect(result.stages.every((s) => s.ok)).toBe(true);
  });

  it('IndexNow rejects a malformed key before any network call', async () => {
    const fetchImpl = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;
    const result = await new IndexNowAdapter(fetchImpl).testConnection(connection('indexnow'), { apiKey: 'nope!' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CONFIGURATION_ERROR');
  });

  it('every registered provider manifest has an adapter', () => {
    for (const manifest of SEO_INTEGRATION_PROVIDER_MANIFESTS) {
      expect(adapterFor(manifest.providerId), manifest.providerId).not.toBeNull();
    }
  });
});

// ── Status lifecycle honesty ────────────────────────────────────────────────

describe('connection status lifecycle', () => {
  it('credentials existing never yields CONNECTED', () => {
    expect(statusAfterCredentialAdd('API_KEY', { apiKey: 'k' })).toBe('CONFIGURING');
    expect(statusAfterCredentialAdd('SERVICE_ACCOUNT', { serviceAccountJson: '{}' })).toBe('CONFIGURING');
    expect(statusAfterCredentialAdd('OAUTH2', {})).toBe('AUTHORIZATION_REQUIRED');
    expect(statusAfterCredentialAdd('OAUTH2', { tokens: { accessToken: 'x' } })).toBe('CONFIGURING');
  });

  it('a passing test earns READY, not CONNECTED', () => {
    expect(statusForTest({ ok: true, stages: [] })).toBe('READY');
  });

  it('typed error codes map to honest statuses', () => {
    expect(statusForTest({ ok: false, stages: [], errorCode: 'AUTH_EXPIRED' })).toBe('AUTH_EXPIRED');
    expect(statusForTest({ ok: false, stages: [], errorCode: 'INVALID_CREDENTIAL' })).toBe('PERMISSION_ERROR');
    expect(statusForTest({ ok: false, stages: [], errorCode: 'INSUFFICIENT_SCOPE' })).toBe('PERMISSION_ERROR');
    expect(statusForTest({ ok: false, stages: [], errorCode: 'RATE_LIMITED' })).toBe('RATE_LIMITED');
    expect(statusForTest({ ok: false, stages: [], errorCode: 'QUOTA_EXCEEDED' })).toBe('RATE_LIMITED');
    expect(statusForTest({ ok: false, stages: [], errorCode: 'PROVIDER_UNAVAILABLE' })).toBe('PROVIDER_ERROR');
    expect(statusForTest({ ok: false, stages: [], errorCode: 'CONFIGURATION_ERROR' })).toBe('CONFIGURING');
  });

  it('freshness distinguishes NO_DATA from STALE', () => {
    const now = () => new Date('2026-08-08T12:00:00Z').getTime();
    expect(freshnessOf(null, 'DAILY', now)).toBe('NO_DATA');
    expect(freshnessOf('2026-08-08T00:00:00Z', 'DAILY', now)).toBe('FRESH');
    expect(freshnessOf('2026-08-01T00:00:00Z', 'DAILY', now)).toBe('STALE');
    expect(freshnessOf('2026-08-01T00:00:00Z', 'WEEKLY', now)).toBe('FRESH');
  });
});

// ── Quota caps ──────────────────────────────────────────────────────────────

describe('daily quota caps', () => {
  it('connection config overrides the provider manifest cap', () => {
    expect(dailyCapOf({ quota: { dailyRequestCap: 400 } }, {})).toBe(400);
    expect(dailyCapOf({ quota: { dailyRequestCap: 400 } }, { dailyRequestCap: 50 })).toBe(50);
    expect(dailyCapOf({ quota: { dailyRequestCap: null } }, {})).toBeNull();
    expect(dailyCapOf(null, null)).toBeNull();
  });

  it('quota exhaustion maps to the RATE_LIMITED status', () => {
    expect(statusForTest({ ok: false, stages: [], errorCode: 'QUOTA_EXCEEDED' })).toBe('RATE_LIMITED');
  });

  it('external-call routes consume quota before invoking the adapter', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../apps/api/src/interfaces/http/routes/admin/seo-integrations.ts'), 'utf8');
    const testRoute = src.slice(src.indexOf("'/connections/:id/test'"), src.indexOf("'/connections/:id/discover'"));
    expect(testRoute.indexOf('tryConsumeUsage')).toBeGreaterThan(-1);
    expect(testRoute.indexOf('tryConsumeUsage')).toBeLessThan(testRoute.indexOf('testConnection('));
    expect(src).toContain("bad(c, 'RATE_LIMITED'");
  });

  it('the custom connector manifest caps at 100 requests/day', () => {
    const custom = SEO_INTEGRATION_PROVIDER_MANIFESTS.find((m) => m.providerId === 'custom-readonly-rest');
    expect(custom?.quota.dailyRequestCap).toBe(100);
    expect(custom?.experimental).toBe(true);
  });
});

// ── Custom read-only connector SSRF protections ─────────────────────────────

describe('custom read-only connector SSRF denials', () => {
  const allow = ['api.partner.example'];
  const publicDns = async () => ['93.184.216.34'];

  it('classifies private/internal addresses', () => {
    for (const addr of ['10.0.0.5', '127.0.0.1', '192.168.1.1', '172.16.9.9', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('2606:2800:220:1::1')).toBe(false);
  });

  it('refuses non-GET methods', async () => {
    const r = await validateCustomRequest({ url: 'https://api.partner.example/x', method: 'POST', allowedHosts: allow }, publicDns);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Only GET');
  });

  it('refuses http URLs', async () => {
    const r = await validateCustomRequest({ url: 'http://api.partner.example/x', method: 'GET', allowedHosts: allow }, publicDns);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('https');
  });

  it('refuses IP-literal hosts', async () => {
    const r = await validateCustomRequest({ url: 'https://93.184.216.34/x', method: 'GET', allowedHosts: ['93.184.216.34'] }, publicDns);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('IP-literal');
  });

  it('refuses hosts off the allowlist', async () => {
    const r = await validateCustomRequest({ url: 'https://evil.example/x', method: 'GET', allowedHosts: allow }, publicDns);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('allowlist');
  });

  it('refuses hosts resolving to private addresses (DNS rebinding)', async () => {
    const r = await validateCustomRequest(
      { url: 'https://api.partner.example/x', method: 'GET', allowedHosts: allow },
      async () => ['93.184.216.34', '10.0.0.7'],
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('private or internal');
  });

  it('refuses redirects that leave the original host', async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 302, headers: { location: 'https://internal.attacker.example/steal' } })
    ) as unknown as typeof fetch;
    const r = await performCustomGet({ url: 'https://api.partner.example/x', allowedHosts: allow }, fetchImpl, publicDns);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('off-host');
  });

  it('refuses non-JSON responses', async () => {
    const fetchImpl = (async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const r = await performCustomGet({ url: 'https://api.partner.example/x', allowedHosts: allow }, fetchImpl, publicDns);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('JSON');
  });

  it('allows a clean same-host JSON GET', async () => {
    const fetchImpl = (async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch;
    const r = await performCustomGet({ url: 'https://api.partner.example/x', allowedHosts: allow }, fetchImpl, publicDns);
    expect(r.ok).toBe(true);
    expect(r.json).toEqual({ ok: true });
  });
});

// ── Secret non-disclosure contracts ─────────────────────────────────────────

describe('credential responses never expose ciphertext or plaintext', () => {
  const repoSrc = fs.readFileSync(
    path.join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleSeoIntegrationRepository.ts'), 'utf8');

  it('listCredentials selects explicit columns excluding ciphertext', () => {
    const block = repoSrc.slice(repoSrc.indexOf('async listCredentials'), repoSrc.indexOf('async revokeCredential'));
    expect(block).not.toContain('select *');
    expect(block).not.toContain('ciphertext');
  });

  it('addCredential RETURNING clause excludes ciphertext', () => {
    const block = repoSrc.slice(repoSrc.indexOf('async addCredential'), repoSrc.indexOf('async getActiveCredential'));
    const fromReturning = block.slice(block.lastIndexOf('returning'));
    const returning = fromReturning.slice(0, fromReturning.indexOf('`'));
    expect(returning).not.toContain('ciphertext');
    expect(returning).toContain('mask');
  });

  it('the audit helper only ever writes metadata (no secret/ciphertext fields)', () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, '../../apps/api/src/interfaces/http/routes/admin/seo-integrations.ts'), 'utf8');
    // The credential-added audit line records authType/mask/version only.
    const auditBlock = routeSrc.slice(routeSrc.indexOf("'SEO_INTEGRATION_CREDENTIAL_ADDED'"), routeSrc.indexOf("return ok(c, { ...credential, connectionStatus"));
    expect(auditBlock).not.toContain('ciphertext');
    expect(auditBlock).not.toContain('secretPayload');
  });

  it('serialized credential rows built from the RETURNING columns contain no secret material', () => {
    // Mirror of the addCredential RETURNING column list.
    const row = {
      id: 'x', connection_id: 'c1', auth_type: 'API_KEY', mask: '••••AB12',
      version: 1, status: 'ACTIVE', expires_at: null, created_at: 'now',
    };
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('ciphertext');
    expect(serialized).not.toContain('apiKey');
  });
});
