import type {
  SeoIntegrationAdapter,
  SeoIntegrationConnectionView,
  SeoIntegrationDiscoveredResources,
  SeoIntegrationSecret,
  SeoIntegrationTestResult,
  SeoIntegrationTestStageResult,
} from '../../../application/ports/SeoIntegrationAdapter';
import { errorCodeForHttpStatus, failedTest } from '../../../application/ports/SeoIntegrationAdapter';
import { getServiceAccountToken, parseServiceAccountJson, GoogleAuthError } from './GoogleServiceAccountAuth';
import { googleOAuthService, GoogleTokenBroker } from '../GoogleOAuthService';
import { CustomReadOnlyRestAdapter } from './CustomReadOnlyRestAdapter';

/**
 * REAL adapters for the SEO Integrations Control Plane. Every testConnection
 * performs staged checks against the live provider API — never fabricated.
 * Generic adapter slots (rank/keyword/backlink/AI) honestly refuse with
 * CONFIGURATION_ERROR until an approved provider adapter is bound.
 *
 * All adapters accept an injectable fetch for tests; secrets are used
 * transiently and never logged.
 */

const STOREFRONT_URL = 'https://shopgoldplus.com';

type Stage = SeoIntegrationTestStageResult;

const stageOk = (stage: Stage['stage'], detail: string): Stage => ({ stage, ok: true, detail });
const stageFail = (stage: Stage['stage'], detail: string): Stage => ({ stage, ok: false, detail });

function saSecret(secret: SeoIntegrationSecret, envVar: string): string | null {
  if (secret && typeof secret.serviceAccountJson === 'string' && secret.serviceAccountJson.trim() !== '') {
    return secret.serviceAccountJson;
  }
  if (secret && typeof secret.serviceAccountJson === 'object' && secret.serviceAccountJson) {
    return JSON.stringify(secret.serviceAccountJson);
  }
  const env = (process.env[envVar] ?? '').trim();
  return env === '' ? null : env;
}

function apiKeySecret(secret: SeoIntegrationSecret, envVar: string): string | null {
  if (secret && typeof secret.apiKey === 'string' && secret.apiKey.trim() !== '') return secret.apiKey.trim();
  const env = (process.env[envVar] ?? '').trim();
  return env === '' ? null : env;
}

async function googleSaToken(
  stages: Stage[],
  rawJson: string,
  scope: string,
): Promise<{ token: string } | { failure: SeoIntegrationTestResult }> {
  let key;
  try {
    key = parseServiceAccountJson(rawJson);
  } catch (err: any) {
    stages.push(stageFail('AUTHENTICATION', String(err?.message ?? err)));
    return { failure: failedTest(stages, 'INVALID_CREDENTIAL', String(err?.message ?? err)) };
  }
  try {
    const token = await getServiceAccountToken(key, scope);
    stages.push(stageOk('AUTHENTICATION', `Token exchange succeeded for ${key.client_email}.`));
    return { token };
  } catch (err: any) {
    const status = err instanceof GoogleAuthError ? err.status : 0;
    stages.push(stageFail('AUTHENTICATION', String(err?.message ?? err)));
    return { failure: failedTest(stages, status === 0 ? 'INVALID_CREDENTIAL' : errorCodeForHttpStatus(status), String(err?.message ?? err)) };
  }
}

// ── Google Search Console ─────────────────────────────────────────────────────

export class GscAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'google-search-console';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private json(secret: SeoIntegrationSecret): string | null {
    return saSecret(secret, 'GSC_SERVICE_ACCOUNT_JSON');
  }

  async testConnection(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const stages: Stage[] = [];
    const raw = this.json(secret);
    if (!raw) return failedTest([stageFail('AUTHENTICATION', 'No service-account credential in vault or environment.')], 'INVALID_CREDENTIAL', 'No credential configured.');
    const auth = await googleSaToken(stages, raw, 'https://www.googleapis.com/auth/webmasters.readonly');
    if ('failure' in auth) return auth.failure;

    const sitesRes = await this.fetchImpl('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!sitesRes.ok) {
      stages.push(stageFail('AUTHORIZATION', `sites.list failed (${sitesRes.status}).`));
      return failedTest(stages, errorCodeForHttpStatus(sitesRes.status), `sites.list failed (${sitesRes.status}).`);
    }
    const sitesBody = await sitesRes.json() as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
    const sites = sitesBody.siteEntry ?? [];
    stages.push(stageOk('AUTHORIZATION', `sites.list returned ${sites.length} accessible propert${sites.length === 1 ? 'y' : 'ies'}.`));

    const siteUrl = String(connection.config.siteUrl ?? (process.env.GSC_SITE_URL ?? '').trim());
    if (siteUrl === '') {
      stages.push(stageFail('RESOURCE_ACCESS', 'No siteUrl configured on the connection yet — select a property.'));
      return failedTest(stages, 'PROPERTY_NOT_FOUND', 'No property selected.');
    }
    if (!sites.some((s) => s.siteUrl === siteUrl)) {
      stages.push(stageFail('RESOURCE_ACCESS', `Property ${siteUrl} is not accessible to this service account.`));
      return failedTest(stages, 'PROPERTY_NOT_FOUND', `Property ${siteUrl} is not accessible.`);
    }
    stages.push(stageOk('RESOURCE_ACCESS', `Property ${siteUrl} is accessible.`));

    const end = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const start = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const queryRes = await this.fetchImpl(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['date'], rowLimit: 1 }),
      },
    );
    if (!queryRes.ok) {
      stages.push(stageFail('TEST_QUERY', `searchAnalytics.query failed (${queryRes.status}).`));
      return failedTest(stages, errorCodeForHttpStatus(queryRes.status), `Test query failed (${queryRes.status}).`);
    }
    stages.push(stageOk('TEST_QUERY', '1-row search-analytics test query succeeded.'));
    return { ok: true, stages };
  }

  async discoverResources(_connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationDiscoveredResources> {
    const raw = this.json(secret);
    if (!raw) return { sites: [] };
    const key = parseServiceAccountJson(raw);
    const token = await getServiceAccountToken(key, 'https://www.googleapis.com/auth/webmasters.readonly');
    const res = await this.fetchImpl('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`sites.list failed (${res.status}).`);
    const body = await res.json() as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
    return { sites: (body.siteEntry ?? []).map((s) => ({ id: s.siteUrl, name: `${s.siteUrl} (${s.permissionLevel})` })) };
  }
}

// ── Google Analytics 4 ────────────────────────────────────────────────────────

export class Ga4Adapter implements SeoIntegrationAdapter {
  readonly providerId = 'google-analytics-4';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async testConnection(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const stages: Stage[] = [];
    const raw = saSecret(secret, 'GA4_SERVICE_ACCOUNT_JSON');
    if (!raw) return failedTest([stageFail('AUTHENTICATION', 'No service-account credential in vault or environment.')], 'INVALID_CREDENTIAL', 'No credential configured.');
    const auth = await googleSaToken(stages, raw, 'https://www.googleapis.com/auth/analytics.readonly');
    if ('failure' in auth) return auth.failure;

    const propertyId = String(connection.config.propertyId ?? connection.propertyRef ?? '').replace(/^properties\//, '');
    if (propertyId === '') {
      stages.push(stageFail('RESOURCE_ACCESS', 'No GA4 propertyId configured yet — set one or discover via the Admin API.'));
      return failedTest(stages, 'PROPERTY_NOT_FOUND', 'No property configured.');
    }
    const res = await this.fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }], metrics: [{ name: 'sessions' }], limit: 1 }),
    });
    if (!res.ok) {
      stages.push(stageFail('TEST_QUERY', `runReport failed (${res.status}).`));
      return failedTest(stages, errorCodeForHttpStatus(res.status), `runReport failed (${res.status}).`);
    }
    stages.push(stageOk('RESOURCE_ACCESS', `Property ${propertyId} is accessible.`));
    stages.push(stageOk('TEST_QUERY', '1-row runReport test succeeded.'));
    return { ok: true, stages };
  }

  async discoverResources(_connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationDiscoveredResources> {
    const raw = saSecret(secret, 'GA4_SERVICE_ACCOUNT_JSON');
    if (!raw) return { properties: [] };
    const key = parseServiceAccountJson(raw);
    const token = await getServiceAccountToken(key, 'https://www.googleapis.com/auth/analytics.readonly');
    const res = await this.fetchImpl('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`accountSummaries failed (${res.status}) — the credential may lack Admin API scope.`);
    const body = await res.json() as { accountSummaries?: Array<{ displayName: string; propertySummaries?: Array<{ property: string; displayName: string }> }> };
    const properties: Array<{ id: string; name: string }> = [];
    const accounts: Array<{ id: string; name: string }> = [];
    for (const acc of body.accountSummaries ?? []) {
      accounts.push({ id: acc.displayName, name: acc.displayName });
      for (const p of acc.propertySummaries ?? []) {
        properties.push({ id: p.property.replace(/^properties\//, ''), name: `${p.displayName} (${acc.displayName})` });
      }
    }
    return { accounts, properties };
  }
}

// ── Google Merchant Center ────────────────────────────────────────────────────

export class MerchantCenterAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'google-merchant-center';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async testConnection(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const stages: Stage[] = [];
    const raw = saSecret(secret, 'MERCHANT_CENTER_SERVICE_ACCOUNT_JSON');
    if (!raw) return failedTest([stageFail('AUTHENTICATION', 'No service-account credential in vault or environment.')], 'INVALID_CREDENTIAL', 'No credential configured.');
    const auth = await googleSaToken(stages, raw, 'https://www.googleapis.com/auth/content');
    if ('failure' in auth) return auth.failure;

    const merchantId = String(connection.config.merchantId ?? connection.accountRef ?? '');
    if (merchantId === '') {
      stages.push(stageFail('RESOURCE_ACCESS', 'No Merchant Center ID configured on the connection.'));
      return failedTest(stages, 'ACCOUNT_NOT_ACCESSIBLE', 'No Merchant Center ID configured.');
    }
    const res = await this.fetchImpl(
      `https://shoppingcontent.googleapis.com/content/v2.1/${encodeURIComponent(merchantId)}/accounts/${encodeURIComponent(merchantId)}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!res.ok) {
      stages.push(stageFail('RESOURCE_ACCESS', `accounts.get failed (${res.status}).`));
      return failedTest(stages, res.status === 404 ? 'ACCOUNT_NOT_ACCESSIBLE' : errorCodeForHttpStatus(res.status), `accounts.get failed (${res.status}).`);
    }
    stages.push(stageOk('RESOURCE_ACCESS', `Merchant account ${merchantId} is accessible.`));
    return { ok: true, stages };
  }
}

// ── Google Business Profile (OAuth2 only) ─────────────────────────────────────

export class GbpAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'google-business-profile';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async testConnection(_connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const stages: Stage[] = [];
    if (!secret || !secret.tokens) {
      stages.push(stageFail('AUTHENTICATION', 'OAuth authorization has not completed for this connection.'));
      return failedTest(stages, 'AUTH_EXPIRED', 'Authorization required — complete the Google OAuth flow.');
    }
    let token: string;
    try {
      const broker = new GoogleTokenBroker(googleOAuthService());
      const result = await broker.accessToken(secret as Record<string, unknown>);
      token = result.token;
      stages.push(stageOk('AUTHENTICATION', 'OAuth access token resolved.'));
    } catch (err: any) {
      stages.push(stageFail('AUTHENTICATION', String(err?.message ?? err)));
      return failedTest(stages, err?.code === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'PROVIDER_UNAVAILABLE', String(err?.message ?? err));
    }
    const res = await this.fetchImpl('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      stages.push(stageFail('RESOURCE_ACCESS', `accounts.list failed (${res.status}).`));
      return failedTest(stages, errorCodeForHttpStatus(res.status), `accounts.list failed (${res.status}).`);
    }
    const body = await res.json() as { accounts?: Array<{ name: string }> };
    stages.push(stageOk('RESOURCE_ACCESS', `accounts.list returned ${(body.accounts ?? []).length} account(s).`));
    return { ok: true, stages };
  }
}

// ── PageSpeed / CrUX (API key) ────────────────────────────────────────────────

export class PageSpeedAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'google-pagespeed';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async testConnection(_c: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const key = apiKeySecret(secret, 'PAGESPEED_API_KEY');
    if (!key) return failedTest([stageFail('AUTHENTICATION', 'No API key in vault or environment.')], 'INVALID_CREDENTIAL', 'No API key configured.');
    const stages: Stage[] = [];
    const res = await this.fetchImpl(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(STOREFRONT_URL)}&category=performance&strategy=mobile&key=${encodeURIComponent(key)}`,
    );
    if (!res.ok) {
      stages.push(stageFail('TEST_QUERY', `runPagespeed failed (${res.status}).`));
      return failedTest(stages, errorCodeForHttpStatus(res.status), `runPagespeed failed (${res.status}).`);
    }
    stages.push(stageOk('AUTHENTICATION', 'API key accepted.'));
    stages.push(stageOk('TEST_QUERY', `Lab run against ${STOREFRONT_URL} succeeded.`));
    return { ok: true, stages };
  }
}

export class CruxAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'google-crux';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async testConnection(_c: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const key = apiKeySecret(secret, 'CRUX_API_KEY');
    if (!key) return failedTest([stageFail('AUTHENTICATION', 'No API key in vault or environment.')], 'INVALID_CREDENTIAL', 'No API key configured.');
    const stages: Stage[] = [];
    const res = await this.fetchImpl(
      `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: STOREFRONT_URL, metrics: ['largest_contentful_paint'] }),
      },
    );
    // 404 = key valid but no CrUX data for the origin yet — an honest, distinct outcome.
    if (res.status === 404) {
      stages.push(stageOk('AUTHENTICATION', 'API key accepted.'));
      stages.push(stageFail('TEST_QUERY', `CrUX has no field data for ${STOREFRONT_URL} yet (404) — the key works; data will appear once traffic qualifies.`));
      return { ok: true, stages };
    }
    if (!res.ok) {
      stages.push(stageFail('TEST_QUERY', `records:queryRecord failed (${res.status}).`));
      return failedTest(stages, errorCodeForHttpStatus(res.status), `records:queryRecord failed (${res.status}).`);
    }
    stages.push(stageOk('AUTHENTICATION', 'API key accepted.'));
    stages.push(stageOk('TEST_QUERY', `Field data query for ${STOREFRONT_URL} succeeded.`));
    return { ok: true, stages };
  }
}

// ── Bing Webmaster ────────────────────────────────────────────────────────────

export class BingWebmasterAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'bing-webmaster';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async testConnection(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const key = apiKeySecret(secret, 'BING_WEBMASTER_API_KEY');
    if (!key) return failedTest([stageFail('AUTHENTICATION', 'No API key in vault or environment.')], 'INVALID_CREDENTIAL', 'No API key configured.');
    const stages: Stage[] = [];
    const res = await this.fetchImpl(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${encodeURIComponent(key)}`);
    if (!res.ok) {
      stages.push(stageFail('AUTHENTICATION', `GetUserSites failed (${res.status}).`));
      return failedTest(stages, errorCodeForHttpStatus(res.status), `GetUserSites failed (${res.status}).`);
    }
    stages.push(stageOk('AUTHENTICATION', 'API key accepted.'));
    const body = await res.json().catch(() => null) as { d?: Array<{ Url: string }> } | null;
    const sites = body?.d ?? [];
    stages.push(stageOk('RESOURCE_ACCESS', `GetUserSites returned ${sites.length} site(s).`));
    const siteUrl = String(connection.config.siteUrl ?? '');
    if (siteUrl !== '' && !sites.some((s) => s.Url?.replace(/\/$/, '') === siteUrl.replace(/\/$/, ''))) {
      stages.push(stageFail('RESOURCE_ACCESS', `Configured site ${siteUrl} is not among the verified sites.`));
      return failedTest(stages, 'PROPERTY_NOT_FOUND', `Site ${siteUrl} is not verified for this key.`);
    }
    return { ok: true, stages };
  }

  async discoverResources(_c: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationDiscoveredResources> {
    const key = apiKeySecret(secret, 'BING_WEBMASTER_API_KEY');
    if (!key) return { sites: [] };
    const res = await this.fetchImpl(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`GetUserSites failed (${res.status}).`);
    const body = await res.json() as { d?: Array<{ Url: string }> };
    return { sites: (body.d ?? []).map((s) => ({ id: s.Url, name: s.Url })) };
  }
}

// ── IndexNow ──────────────────────────────────────────────────────────────────

export class IndexNowAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'indexnow';
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async testConnection(_c: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const key = apiKeySecret(secret, 'INDEXNOW_KEY');
    const stages: Stage[] = [];
    if (!key) return failedTest([stageFail('AUTHENTICATION', 'No IndexNow key in vault or environment.')], 'INVALID_CREDENTIAL', 'No key configured.');
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
      stages.push(stageFail('AUTHENTICATION', 'Key format invalid (expect 8–128 alphanumeric/dash chars).'));
      return failedTest(stages, 'CONFIGURATION_ERROR', 'IndexNow key format is invalid.');
    }
    stages.push(stageOk('AUTHENTICATION', 'Key format valid.'));
    const keyUrl = `${STOREFRONT_URL}/${key}.txt`;
    const res = await this.fetchImpl(keyUrl).catch(() => null);
    if (!res || !res.ok) {
      stages.push(stageFail('RESOURCE_ACCESS', `Key file not reachable at ${keyUrl} (${res ? res.status : 'network error'}). Serve it before submitting.`));
      return failedTest(stages, 'CONFIGURATION_ERROR', `Key file not reachable at ${keyUrl}.`);
    }
    const body = (await res.text().catch(() => '')).trim();
    if (body !== key) {
      stages.push(stageFail('RESOURCE_ACCESS', `Key file at ${keyUrl} does not contain the key.`));
      return failedTest(stages, 'CONFIGURATION_ERROR', 'Key file content does not match the key.');
    }
    stages.push(stageOk('RESOURCE_ACCESS', `Key file verified at ${keyUrl}.`));
    return { ok: true, stages };
  }
}

// ── Generic adapter slots (honest: no bound provider yet) ─────────────────────

export class GenericSlotAdapter implements SeoIntegrationAdapter {
  constructor(readonly providerId: string) {}

  async testConnection(connection: SeoIntegrationConnectionView, _secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const bound = String(connection.config.providerName ?? (process.env[`SEO_${this.providerId.replace(/-/g, '_').toUpperCase()}_BOUND_PROVIDER`] ?? ''));
    // No approved provider adapters exist for this slot yet; any claimed name is unsupported.
    const detail = bound === ''
      ? 'No approved provider adapter bound yet'
      : `No approved provider adapter bound yet — '${bound}' is not a supported provider id.`;
    return failedTest([stageFail('ENDPOINT', detail)], 'CONFIGURATION_ERROR', detail);
  }
}

// ── Google Ads Keyword (experimental — approval-gated) ────────────────────────

export class GoogleAdsKeywordAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'google-ads-keyword';

  async testConnection(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const stages: Stage[] = [];
    if (!secret || !secret.tokens) {
      stages.push(stageFail('AUTHENTICATION', 'OAuth authorization has not completed for this connection.'));
      return failedTest(stages, 'AUTH_EXPIRED', 'Authorization required — complete the Google OAuth flow.');
    }
    const approval = String(connection.config.developerToken ?? '');
    if (approval !== 'APPROVED') {
      stages.push(stageFail('AUTHORIZATION', 'Google Ads API developer-token access has not been approved yet.'));
      return failedTest(stages, 'INSUFFICIENT_SCOPE', 'Google Ads API access approval required before this provider can be tested.');
    }
    stages.push(stageFail('TEST_QUERY', 'Google Ads keyword adapter is experimental; live query support lands with the approved developer token.'));
    return failedTest(stages, 'CONFIGURATION_ERROR', 'Experimental adapter — live queries not enabled yet.');
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function adapterFor(providerId: string, fetchImpl: typeof fetch = fetch): SeoIntegrationAdapter | null {
  switch (providerId) {
    case 'google-search-console': return new GscAdapter(fetchImpl);
    case 'google-analytics-4': return new Ga4Adapter(fetchImpl);
    case 'google-merchant-center': return new MerchantCenterAdapter(fetchImpl);
    case 'google-business-profile': return new GbpAdapter(fetchImpl);
    case 'google-pagespeed': return new PageSpeedAdapter(fetchImpl);
    case 'google-crux': return new CruxAdapter(fetchImpl);
    case 'google-ads-keyword': return new GoogleAdsKeywordAdapter();
    case 'bing-webmaster': return new BingWebmasterAdapter(fetchImpl);
    case 'indexnow': return new IndexNowAdapter(fetchImpl);
    case 'rank-tracker-generic':
    case 'keyword-provider-generic':
    case 'backlink-provider-generic':
    case 'ai-engine-observation':
      return new GenericSlotAdapter(providerId);
    case 'custom-readonly-rest': return new CustomReadOnlyRestAdapter(fetchImpl);
    default: return null;
  }
}
