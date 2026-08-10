/**
 * RegisterSeoIntegrationProvidersUseCase — idempotently upserts the canonical
 * SEO integration provider manifests into seo_integration_providers.
 *
 * The manifest is the single source of truth the admin UI renders forms from
 * (configurationSchema + credentialSchema field descriptors). Experimental
 * providers say so; adapter slots without a bound real adapter stay honest and
 * refuse to pretend a connection can be tested.
 */

export interface SeoProviderManifestField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'select' | 'number' | 'password-json';
  required: boolean;
  help?: string;
  options?: string[];
}

export interface SeoProviderManifest {
  providerId: string;
  canonicalName: string;
  family: string;
  description: string;
  authTypes: string[];
  capabilities: string[];
  supports: {
    webhooks: boolean;
    backfill: boolean;
    manualSync: boolean;
    incrementalSync: boolean;
    testConnection: boolean;
    multipleConnections: boolean;
  };
  defaultSyncFrequency: string | null;
  docsUrl: string | null;
  enabled: boolean;
  experimental: boolean;
  adapterVersion: string;
  configurationSchema: SeoProviderManifestField[];
  credentialSchema: SeoProviderManifestField[];
  quota: { dailyRequestCap: number | null; notes?: string };
  backfillWindowMonths?: number;
  oauthScopes?: string[];
  notes?: string;
}

export interface SeoIntegrationProviderStore {
  upsertProvider(manifest: SeoProviderManifest): Promise<unknown>;
}

const S = (overrides: Partial<SeoProviderManifest['supports']> = {}): SeoProviderManifest['supports'] => ({
  webhooks: false,
  backfill: false,
  manualSync: true,
  incrementalSync: false,
  testConnection: true,
  multipleConnections: false,
  ...overrides,
});

const apiKeyCredential = (help: string): SeoProviderManifestField[] => ([
  { key: 'apiKey', label: 'API key', type: 'text', required: true, help },
]);

const serviceAccountCredential: SeoProviderManifestField[] = [
  { key: 'serviceAccountJson', label: 'Service-account JSON key', type: 'password-json', required: true, help: 'Full JSON key file contents. Grant the service-account email access on the Google property first.' },
];

export const SEO_INTEGRATION_PROVIDER_MANIFESTS: SeoProviderManifest[] = [
  {
    providerId: 'google-search-console',
    canonicalName: 'Google Search Console',
    family: 'GOOGLE_SEARCH',
    description: 'Search analytics (clicks, impressions, CTR, position), sitemap management and URL inspection for verified properties.',
    authTypes: ['SERVICE_ACCOUNT', 'OAUTH2'],
    capabilities: ['SEARCH_ANALYTICS', 'SITEMAP_MANAGEMENT', 'URL_INSPECTION'],
    supports: S({ backfill: true, incrementalSync: true, multipleConnections: true }),
    defaultSyncFrequency: 'DAILY',
    docsUrl: 'https://developers.google.com/webmaster-tools',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'siteUrl', label: 'Property (site URL)', type: 'text', required: true, help: 'e.g. sc-domain:shopgoldplus.com or https://shopgoldplus.com/ — discoverable after credentials are added.' },
    ],
    credentialSchema: serviceAccountCredential,
    quota: { dailyRequestCap: 2000 },
    backfillWindowMonths: 16,
    oauthScopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  },
  {
    providerId: 'google-analytics-4',
    canonicalName: 'Google Analytics 4',
    family: 'GOOGLE_ANALYTICS',
    description: 'Web and e-commerce analytics via the GA4 Data API.',
    authTypes: ['SERVICE_ACCOUNT', 'OAUTH2'],
    capabilities: ['WEB_ANALYTICS', 'ECOMMERCE_ANALYTICS'],
    supports: S({ backfill: true, incrementalSync: true }),
    defaultSyncFrequency: 'DAILY',
    docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'propertyId', label: 'GA4 property ID', type: 'text', required: true, help: 'Numeric property id, e.g. 123456789 — discoverable via the Admin API when the credential allows it.' },
    ],
    credentialSchema: serviceAccountCredential,
    quota: { dailyRequestCap: 2000 },
    oauthScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  },
  {
    providerId: 'google-merchant-center',
    canonicalName: 'Google Merchant Center',
    family: 'GOOGLE_MERCHANT',
    description: 'Product feed status, diagnostics and shopping performance via the Content API.',
    authTypes: ['SERVICE_ACCOUNT'],
    capabilities: ['PRODUCT_FEED', 'PRODUCT_DIAGNOSTICS', 'PRODUCT_PERFORMANCE'],
    supports: S({ incrementalSync: true }),
    defaultSyncFrequency: 'DAILY',
    docsUrl: 'https://developers.google.com/shopping-content/guides/quickstart',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'merchantId', label: 'Merchant Center ID', type: 'text', required: true },
    ],
    credentialSchema: serviceAccountCredential,
    quota: { dailyRequestCap: 1000 },
    oauthScopes: ['https://www.googleapis.com/auth/content'],
  },
  {
    providerId: 'google-business-profile',
    canonicalName: 'Google Business Profile',
    family: 'GOOGLE_LOCAL',
    description: 'Business profile info, local performance and reviews. Requires an OAuth consent flow (no service-account access).',
    authTypes: ['OAUTH2'],
    capabilities: ['BUSINESS_PROFILE', 'LOCAL_PERFORMANCE', 'REVIEWS', 'BUSINESS_INFO'],
    supports: S({ incrementalSync: true }),
    defaultSyncFrequency: 'DAILY',
    docsUrl: 'https://developers.google.com/my-business',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'locationId', label: 'Location ID', type: 'text', required: false, help: 'Discoverable after OAuth authorization completes.' },
    ],
    credentialSchema: [],
    quota: { dailyRequestCap: 1000 },
    oauthScopes: ['https://www.googleapis.com/auth/business.manage'],
    notes: 'Connections stay AUTHORIZATION_REQUIRED until the Google OAuth flow completes.',
  },
  {
    providerId: 'google-pagespeed',
    canonicalName: 'Google PageSpeed Insights',
    family: 'WEB_PERFORMANCE',
    description: 'Lab performance (Lighthouse) for storefront URLs.',
    authTypes: ['API_KEY'],
    capabilities: ['LAB_PERFORMANCE'],
    supports: S(),
    defaultSyncFrequency: 'WEEKLY',
    docsUrl: 'https://developers.google.com/speed/docs/insights/v5/get-started',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [],
    credentialSchema: apiKeyCredential('Google Cloud API key with the PageSpeed Insights API enabled.'),
    quota: { dailyRequestCap: 400 },
  },
  {
    providerId: 'google-crux',
    canonicalName: 'Chrome UX Report (CrUX)',
    family: 'WEB_PERFORMANCE',
    description: 'Field performance (real-user Core Web Vitals) from the CrUX API.',
    authTypes: ['API_KEY'],
    capabilities: ['FIELD_PERFORMANCE'],
    supports: S(),
    defaultSyncFrequency: 'WEEKLY',
    docsUrl: 'https://developer.chrome.com/docs/crux/api',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [],
    credentialSchema: apiKeyCredential('Google Cloud API key with the Chrome UX Report API enabled.'),
    quota: { dailyRequestCap: 400 },
  },
  {
    providerId: 'google-ads-keyword',
    canonicalName: 'Google Ads Keyword Planner',
    family: 'GOOGLE_PERFORMANCE',
    description: 'Keyword volumes and trends via the Google Ads API. EXPERIMENTAL: requires approved Google Ads API developer-token access.',
    authTypes: ['OAUTH2'],
    capabilities: ['KEYWORD_VOLUME', 'KEYWORD_TRENDS'],
    supports: S(),
    defaultSyncFrequency: 'MONTHLY',
    docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
    enabled: true,
    experimental: true,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'customerId', label: 'Google Ads customer ID', type: 'text', required: true },
      { key: 'developerToken', label: 'Developer token status', type: 'select', required: false, options: ['PENDING_APPROVAL', 'APPROVED'], help: 'Google Ads API access approval is required before this provider can sync.' },
    ],
    credentialSchema: [],
    quota: { dailyRequestCap: 200 },
    oauthScopes: ['https://www.googleapis.com/auth/adwords'],
  },
  {
    providerId: 'bing-webmaster',
    canonicalName: 'Bing Webmaster Tools',
    family: 'MICROSOFT_SEARCH',
    description: 'Bing search analytics, index submission and sitemap management.',
    authTypes: ['API_KEY'],
    capabilities: ['SEARCH_ANALYTICS', 'INDEX_SUBMISSION', 'SITEMAP_MANAGEMENT'],
    supports: S({ incrementalSync: true }),
    defaultSyncFrequency: 'DAILY',
    docsUrl: 'https://learn.microsoft.com/en-us/bingwebmaster/getting-access',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'siteUrl', label: 'Verified site URL', type: 'url', required: true },
    ],
    credentialSchema: apiKeyCredential('Bing Webmaster Tools API key (Settings → API access).'),
    quota: { dailyRequestCap: 1000 },
  },
  {
    providerId: 'indexnow',
    canonicalName: 'IndexNow',
    family: 'INDEXING_PROTOCOL',
    description: 'Instant URL change notification to IndexNow-participating engines. The key is published at https://shopgoldplus.com/<key>.txt.',
    authTypes: ['API_KEY'],
    capabilities: ['INDEX_SUBMISSION'],
    supports: S(),
    defaultSyncFrequency: null,
    docsUrl: 'https://www.indexnow.org/documentation',
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [],
    credentialSchema: apiKeyCredential('IndexNow key (8–128 hex/dash chars). Must be served at https://shopgoldplus.com/<key>.txt.'),
    quota: { dailyRequestCap: 200 },
  },
  {
    providerId: 'rank-tracker-generic',
    canonicalName: 'Rank Tracker (adapter slot)',
    family: 'SERP_PROVIDER',
    description: 'Provider-agnostic slot for a SERP rank-tracking service. No approved provider adapter is bound yet — connections stay honestly unconfigured until one is.',
    authTypes: ['API_KEY'],
    capabilities: ['SERP_RANK', 'SERP_FEATURES'],
    supports: S({ testConnection: false }),
    defaultSyncFrequency: 'WEEKLY',
    docsUrl: null,
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'providerName', label: 'Provider', type: 'select', required: true, options: [], help: 'No approved provider adapter bound yet.' },
    ],
    credentialSchema: apiKeyCredential('API key for the bound provider (once one is approved).'),
    quota: { dailyRequestCap: 500 },
  },
  {
    providerId: 'keyword-provider-generic',
    canonicalName: 'Keyword Data Provider (adapter slot)',
    family: 'KEYWORD_PROVIDER',
    description: 'Provider-agnostic slot for keyword volume/trend data. No approved provider adapter is bound yet.',
    authTypes: ['API_KEY'],
    capabilities: ['KEYWORD_VOLUME', 'KEYWORD_TRENDS'],
    supports: S({ testConnection: false }),
    defaultSyncFrequency: 'MONTHLY',
    docsUrl: null,
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'providerName', label: 'Provider', type: 'select', required: true, options: [], help: 'No approved provider adapter bound yet.' },
    ],
    credentialSchema: apiKeyCredential('API key for the bound provider (once one is approved).'),
    quota: { dailyRequestCap: 500 },
  },
  {
    providerId: 'backlink-provider-generic',
    canonicalName: 'Backlink Data Provider (adapter slot)',
    family: 'BACKLINK_PROVIDER',
    description: 'Provider-agnostic slot for backlink / link-gap / brand-mention data. No approved provider adapter is bound yet.',
    authTypes: ['API_KEY'],
    capabilities: ['BACKLINKS', 'LINK_GAP', 'BRAND_MENTIONS'],
    supports: S({ testConnection: false }),
    defaultSyncFrequency: 'WEEKLY',
    docsUrl: null,
    enabled: true,
    experimental: false,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'providerName', label: 'Provider', type: 'select', required: true, options: [], help: 'No approved provider adapter bound yet.' },
    ],
    credentialSchema: apiKeyCredential('API key for the bound provider (once one is approved).'),
    quota: { dailyRequestCap: 500 },
  },
  {
    providerId: 'ai-engine-observation',
    canonicalName: 'AI Engine Observation (adapter slot)',
    family: 'AI_ENGINE',
    description: 'EXPERIMENTAL slot for observing AI answer-engine responses (mention/citation tracking). No approved provider adapter is bound yet.',
    authTypes: ['API_KEY'],
    capabilities: ['AI_RESPONSE_OBSERVATION'],
    supports: S({ testConnection: false }),
    defaultSyncFrequency: 'WEEKLY',
    docsUrl: null,
    enabled: true,
    experimental: true,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'providerName', label: 'Provider', type: 'select', required: true, options: [], help: 'No approved provider adapter bound yet.' },
    ],
    credentialSchema: apiKeyCredential('API key for the bound provider (once one is approved).'),
    quota: { dailyRequestCap: 200 },
  },
  {
    providerId: 'custom-readonly-rest',
    canonicalName: 'Custom Read-only REST Source',
    family: 'CUSTOM_READ_ONLY',
    description: 'EXPERIMENTAL: read-only GET-only JSON source over https with a server-side hostname allowlist, SSRF protections, 10s timeout and a 100 requests/day cap.',
    authTypes: ['API_KEY', 'BEARER_TOKEN', 'CUSTOM_HEADER', 'NONE'],
    capabilities: ['CUSTOM_READ_ONLY_FETCH'],
    supports: S({ multipleConnections: true }),
    defaultSyncFrequency: null,
    docsUrl: null,
    enabled: true,
    experimental: true,
    adapterVersion: '1',
    configurationSchema: [
      { key: 'baseUrl', label: 'Base URL (https only)', type: 'url', required: true, help: 'Hostname must be on the connection allowlist; private/internal addresses are refused.' },
      { key: 'allowedHosts', label: 'Hostname allowlist (comma-separated)', type: 'text', required: true },
      { key: 'headerName', label: 'Auth header name', type: 'text', required: false, help: 'Explicit header the credential is sent in, e.g. Authorization or X-Api-Key.' },
    ],
    credentialSchema: [
      { key: 'token', label: 'Token / API key (optional)', type: 'text', required: false },
    ],
    quota: { dailyRequestCap: 100 },
  },
];

export class RegisterSeoIntegrationProvidersUseCase {
  constructor(private readonly store: SeoIntegrationProviderStore) {}

  async execute(): Promise<{ registered: number }> {
    for (const manifest of SEO_INTEGRATION_PROVIDER_MANIFESTS) {
      await this.store.upsertProvider(manifest);
    }
    return { registered: SEO_INTEGRATION_PROVIDER_MANIFESTS.length };
  }
}
