/**
 * SeoIntegrationAdapter — the port every SEO integration provider adapter
 * implements. Adapters live in infrastructure/seo/adapters; use cases and
 * routes see only this contract.
 *
 * Honesty contract (CLAUDE.md): testConnection performs REAL staged checks
 * against the provider (or returns CONFIGURATION_ERROR when nothing real can
 * be tested). It never fabricates success.
 */

export type SeoIntegrationTestStage =
  | 'ENDPOINT'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'RESOURCE_ACCESS'
  | 'TEST_QUERY';

export type SeoIntegrationErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'AUTH_EXPIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'PROPERTY_NOT_FOUND'
  | 'ACCOUNT_NOT_ACCESSIBLE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CONFIGURATION_ERROR';

export interface SeoIntegrationTestStageResult {
  stage: SeoIntegrationTestStage;
  ok: boolean;
  detail: string;
}

export interface SeoIntegrationTestResult {
  ok: boolean;
  stages: SeoIntegrationTestStageResult[];
  errorCode?: SeoIntegrationErrorCode;
  errorMessage?: string;
}

export interface SeoIntegrationConnectionView {
  id: string;
  providerId: string;
  name: string;
  status: string;
  accountRef: string | null;
  propertyRef: string | null;
  /** NON-SECRET configuration only. */
  config: Record<string, unknown>;
}

/** Decrypted secret payload — passed transiently, never logged or persisted. */
export type SeoIntegrationSecret = Record<string, unknown> | null;

export interface SeoIntegrationDiscoveredResources {
  accounts?: Array<{ id: string; name: string }>;
  properties?: Array<{ id: string; name: string }>;
  sites?: Array<{ id: string; name: string }>;
}

export interface SeoIntegrationSyncOutcome {
  status: 'SYNCED' | 'NO_NEW_DATA' | 'FAILED' | 'NOT_SUPPORTED';
  recordsRead?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  error?: string;
}

export interface SeoIntegrationAdapter {
  readonly providerId: string;
  testConnection(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult>;
  discoverResources?(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationDiscoveredResources>;
  sync?(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationSyncOutcome>;
}

/** Shape a staged failure into the canonical TestResult. */
export function failedTest(
  stages: SeoIntegrationTestStageResult[],
  errorCode: SeoIntegrationErrorCode,
  errorMessage: string,
): SeoIntegrationTestResult {
  return { ok: false, stages, errorCode, errorMessage };
}

/** Map an upstream HTTP status to the typed error vocabulary. */
export function errorCodeForHttpStatus(status: number): SeoIntegrationErrorCode {
  if (status === 401) return 'INVALID_CREDENTIAL';
  if (status === 403) return 'INSUFFICIENT_SCOPE';
  if (status === 404) return 'PROPERTY_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'CONFIGURATION_ERROR';
}
