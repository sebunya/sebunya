import { Registry } from '../Registry';
import { logger } from '../logging/logger';
import { IntegrationCredentialVault } from './IntegrationCredentialVault';
import { GscClient } from './GscClient';

/**
 * SeoIntegrationSyncRunner — executes a 'seo-integration-sync' queue job.
 * Routes by providerId; each connection's sync is fully isolated: adapter and
 * provider failures land on the job row and the connection status, never in
 * commerce paths.
 *
 * Credential resolution is vault-first (the connection's ACTIVE encrypted
 * credential), falling back to the legacy env vars so the pre-0118 bootstrap
 * path keeps working.
 */

export interface SeoIntegrationSyncJobData {
  jobId: string;
  connectionId: string;
  providerId: string;
}

export async function resolveGscClientVaultFirst(): Promise<GscClient | null> {
  try {
    const repo = Registry.getInstance().seoIntegrationRepo;
    const connection = await repo.findConnectionWithActiveCredential('google-search-console');
    if (connection) {
      const credential = await repo.getActiveCredential(connection.id);
      const vault = IntegrationCredentialVault.fromEnv();
      if (credential && vault) {
        const secret = vault.decrypt<Record<string, unknown>>(credential.ciphertext);
        const json = typeof secret.serviceAccountJson === 'string'
          ? secret.serviceAccountJson
          : secret.serviceAccountJson ? JSON.stringify(secret.serviceAccountJson) : null;
        const siteUrl = String((connection.config ?? {}).siteUrl ?? connection.property_ref ?? '');
        if (json && siteUrl !== '') return new GscClient(json, siteUrl);
      }
    }
  } catch (err) {
    logger.warn({ err }, '[SeoIntegrationSync] Vault-based GSC credential resolution failed; falling back to env');
  }
  return GscClient.fromEnv();
}

export async function runSeoIntegrationSyncJob(data: SeoIntegrationSyncJobData): Promise<void> {
  const registry = Registry.getInstance();
  const repo = registry.seoIntegrationRepo;
  const job = await repo.updateSyncJob(data.jobId, { status: 'RUNNING', startedAt: new Date() });
  if (!job || job.status === 'CANCELLED') return;
  const connection = await repo.getConnection(data.connectionId);
  if (!connection) {
    await repo.updateSyncJob(data.jobId, { status: 'FAILED', completedAt: new Date(), error: 'Connection no longer exists.' });
    return;
  }
  await repo.setConnectionStatus(connection.id, { status: 'SYNCING', lastAttemptAt: new Date() });

  try {
    if (data.providerId === 'google-search-console') {
      const { SyncGscPerformanceUseCase } = await import('../../application/use-cases/seo-growth/SyncGscPerformanceUseCase');
      const client = await resolveGscClientVaultFirst();
      const outcome = await new SyncGscPerformanceUseCase({ client, store: registry.seoGrowthRepo }).execute();
      if (outcome.status === 'SYNCED') {
        await repo.updateSyncJob(data.jobId, {
          status: 'COMPLETE', completedAt: new Date(),
          recordsRead: outcome.rowsUpserted, recordsInserted: outcome.rowsUpserted,
          cursor: { lastSyncedDate: outcome.endDate },
        });
        await repo.setConnectionStatus(connection.id, {
          status: 'HEALTHY', lastSuccessAt: new Date(), dataFreshnessAt: new Date(`${outcome.endDate}T00:00:00Z`), lastError: null,
        });
      } else if (outcome.status === 'NO_NEW_DATA') {
        await repo.updateSyncJob(data.jobId, { status: 'COMPLETE', completedAt: new Date(), cursor: { lastSyncedDate: outcome.lastSyncedDate } });
        await repo.setConnectionStatus(connection.id, { status: 'HEALTHY', lastSuccessAt: new Date(), lastError: null });
      } else if (outcome.status === 'READY_FOR_CREDENTIALS') {
        await repo.updateSyncJob(data.jobId, { status: 'FAILED', completedAt: new Date(), error: 'No credentials available (vault or env).' });
        await repo.setConnectionStatus(connection.id, { status: 'NOT_CONFIGURED', lastError: 'No credentials available.' });
      } else {
        await repo.updateSyncJob(data.jobId, { status: 'FAILED', completedAt: new Date(), error: outcome.error });
        await repo.setConnectionStatus(connection.id, { status: 'PROVIDER_ERROR', lastError: outcome.error });
      }
      return;
    }

    // No other provider has a real sync pipeline yet — say so honestly.
    await repo.updateSyncJob(data.jobId, {
      status: 'FAILED', completedAt: new Date(),
      error: `Provider '${data.providerId}' has no sync implementation yet; only test-connection and discovery are available.`,
    });
    await repo.setConnectionStatus(connection.id, { status: 'READY', lastError: null });
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 500);
    logger.error({ jobId: data.jobId, providerId: data.providerId, err: message }, '[SeoIntegrationSync] Job failed');
    await repo.updateSyncJob(data.jobId, { status: 'FAILED', completedAt: new Date(), error: message });
    await repo.setConnectionStatus(connection.id, { status: 'PROVIDER_ERROR', lastError: message });
  }
}
