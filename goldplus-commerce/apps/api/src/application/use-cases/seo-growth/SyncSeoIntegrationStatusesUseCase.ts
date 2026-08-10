/**
 * SyncSeoIntegrationStatusesUseCase — computes each SEO integration's live
 * credential presence from the environment and reports it honestly.
 *
 * Contract (CLAUDE.md): no fake integrations. An integration whose expected
 * env vars are all present is a 'CONNECTED' candidate; otherwise it is
 * 'READY_FOR_CREDENTIALS'. Only boolean presence per VAR NAME ever leaves this
 * use case — never a value, never a prefix, never a length.
 */

export const SEO_INTEGRATION_ENV_VARS: Record<string, string[]> = {
  GSC: ['GSC_CLIENT_EMAIL', 'GSC_PRIVATE_KEY', 'GSC_SITE_URL'],
  GA4: ['GA4_PROPERTY_ID', 'GA4_CLIENT_EMAIL', 'GA4_PRIVATE_KEY'],
  MERCHANT_CENTER: ['MERCHANT_CENTER_ID', 'MERCHANT_CENTER_CLIENT_EMAIL', 'MERCHANT_CENTER_PRIVATE_KEY'],
  GBP: ['GBP_CLIENT_EMAIL', 'GBP_PRIVATE_KEY', 'GBP_LOCATION_ID'],
  KEYWORD_PROVIDER: ['KEYWORD_PROVIDER_API_KEY'],
  RANK_TRACKER: ['RANK_TRACKER_API_KEY'],
  BACKLINK_PROVIDER: ['BACKLINK_PROVIDER_API_KEY'],
  BING_WEBMASTER: ['BING_WEBMASTER_API_KEY'],
  INDEXNOW: ['INDEXNOW_KEY'],
  PAGESPEED: ['PAGESPEED_API_KEY'],
  CRUX: ['CRUX_API_KEY'],
};

export interface SeoIntegrationRow {
  provider: string;
  status: string;
  config: Record<string, unknown>;
  last_success_at?: unknown;
  last_failure_at?: unknown;
  last_error?: unknown;
}

export interface SeoIntegrationView {
  provider: string;
  status: string;
  envVars: Array<{ name: string; present: boolean }>;
  computedStatus: 'CONNECTED' | 'READY_FOR_CREDENTIALS' | null;
  lastSuccessAt: unknown;
  lastFailureAt: unknown;
  lastError: unknown;
}

export interface SeoIntegrationStore {
  listIntegrations(): Promise<SeoIntegrationRow[]>;
  upsertIntegrationStatus(provider: string, patch: { status?: string; config?: Record<string, unknown> }): Promise<unknown>;
}

/** Pure presence computation — exported for tests. Never returns values. */
export function computeEnvPresence(
  expectedVars: string[],
  env: Record<string, string | undefined>,
): { envVars: Array<{ name: string; present: boolean }>; computedStatus: 'CONNECTED' | 'READY_FOR_CREDENTIALS' | null } {
  if (expectedVars.length === 0) return { envVars: [], computedStatus: null };
  const envVars = expectedVars.map((name) => ({
    name,
    present: typeof env[name] === 'string' && env[name]!.trim() !== '',
  }));
  return { envVars, computedStatus: envVars.every((v) => v.present) ? 'CONNECTED' : 'READY_FOR_CREDENTIALS' };
}

export class SyncSeoIntegrationStatusesUseCase {
  constructor(
    private readonly store: SeoIntegrationStore,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async execute(): Promise<SeoIntegrationView[]> {
    // Ensure every known provider has a row (declaration only, no secrets in config).
    const existing = await this.store.listIntegrations();
    const byProvider = new Map(existing.map((r) => [r.provider, r]));
    for (const provider of Object.keys(SEO_INTEGRATION_ENV_VARS)) {
      if (!byProvider.has(provider)) {
        const row = (await this.store.upsertIntegrationStatus(provider, {
          config: { envVars: SEO_INTEGRATION_ENV_VARS[provider] },
        })) as SeoIntegrationRow;
        if (row) byProvider.set(provider, row);
      }
    }

    const views: SeoIntegrationView[] = [];
    for (const row of byProvider.values()) {
      const declared = Array.isArray((row.config as any)?.envVars)
        ? ((row.config as any).envVars as unknown[]).map(String)
        : SEO_INTEGRATION_ENV_VARS[row.provider] ?? [];
      const { envVars, computedStatus } = computeEnvPresence(declared, this.env);

      let status = row.status;
      // Report + persist the computed state, but never overwrite a manual
      // DISABLED or a recorded ERROR with a mere env presence check.
      if (computedStatus && status !== 'DISABLED' && status !== 'ERROR' && status !== computedStatus) {
        await this.store.upsertIntegrationStatus(row.provider, { status: computedStatus });
        status = computedStatus;
      }
      views.push({
        provider: row.provider,
        status,
        envVars,
        computedStatus,
        lastSuccessAt: row.last_success_at ?? null,
        lastFailureAt: row.last_failure_at ?? null,
        lastError: row.last_error ?? null,
      });
    }
    return views.sort((a, b) => a.provider.localeCompare(b.provider));
  }
}
