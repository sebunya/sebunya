import type { SeoIntegrationTestResult } from '../../ports/SeoIntegrationAdapter';

/**
 * SeoIntegrationLifecycle — pure status/freshness/quota rules for the 0118
 * integrations control plane. Kept in the application layer so the honest
 * lifecycle is unit-testable without HTTP or a database.
 *
 * Honesty rules:
 *  - Credentials existing ≠ CONNECTED. Adding a credential yields CONFIGURING
 *    (or AUTHORIZATION_REQUIRED for an OAuth2 credential without tokens).
 *  - READY is earned only by a passing staged test.
 *  - CONNECTED/HEALTHY are earned only by a successful data operation.
 */

export function statusAfterCredentialAdd(authType: string, payload: Record<string, unknown>): string {
  return authType === 'OAUTH2' && !payload.tokens ? 'AUTHORIZATION_REQUIRED' : 'CONFIGURING';
}

/** Map an adapter staged-test result to the honest connection status. */
export function statusForTest(result: SeoIntegrationTestResult): string {
  if (result.ok) return 'READY';
  switch (result.errorCode) {
    case 'AUTH_EXPIRED': return 'AUTH_EXPIRED';
    case 'INVALID_CREDENTIAL':
    case 'INSUFFICIENT_SCOPE': return 'PERMISSION_ERROR';
    case 'RATE_LIMITED':
    case 'QUOTA_EXCEEDED': return 'RATE_LIMITED';
    case 'PROVIDER_UNAVAILABLE': return 'PROVIDER_ERROR';
    default: return 'CONFIGURING';
  }
}

const FREQ_MS: Record<string, number> = {
  HOURLY: 3_600_000,
  DAILY: 86_400_000,
  WEEKLY: 7 * 86_400_000,
  MONTHLY: 30 * 86_400_000,
};

/** Fresh if last success within 2× the sync frequency; NO_DATA is distinct from STALE. */
export function freshnessOf(
  lastSuccessAt: Date | string | null,
  syncFrequency: string | null,
  now: () => number = Date.now,
): 'FRESH' | 'STALE' | 'NO_DATA' {
  if (!lastSuccessAt) return 'NO_DATA';
  const last = new Date(lastSuccessAt).getTime();
  const freq = FREQ_MS[String(syncFrequency ?? 'DAILY')] ?? FREQ_MS.DAILY;
  return now() - last <= 2 * freq ? 'FRESH' : 'STALE';
}

/** Daily external-call cap: per-connection config override, else provider manifest quota, else uncapped. */
export function dailyCapOf(
  providerManifest: { quota?: { dailyRequestCap?: number | null } } | null | undefined,
  connectionConfig: Record<string, unknown> | null | undefined,
): number | null {
  const override = Number((connectionConfig ?? {}).dailyRequestCap);
  if (Number.isFinite(override) && override > 0) return override;
  const cap = Number(providerManifest?.quota?.dailyRequestCap);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}
