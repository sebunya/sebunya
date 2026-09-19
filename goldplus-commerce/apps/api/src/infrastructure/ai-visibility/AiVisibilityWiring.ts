import type { CreateAuditLogUseCase } from '../../application/use-cases/audit/CreateAuditLogUseCase';
import type { AlertSink, CredentialCipher, RunQueue } from '../../application/ports/AiVisibility';
import { AiVisibilitySetupUseCases } from '../../application/use-cases/ai-visibility/AiVisibilitySetupUseCases';
import { AiVisibilityRunUseCases } from '../../application/use-cases/ai-visibility/AiVisibilityRunUseCases';
import { AiVisibilityInsightsUseCases } from '../../application/use-cases/ai-visibility/AiVisibilityInsightsUseCases';
import { AiVisibilityActionUseCases } from '../../application/use-cases/ai-visibility/AiVisibilityActionUseCases';
import { appLogger } from '../../application/logging/appLogger';
import { DrizzleAiVisibilityRepository } from '../db/repositories/DrizzleAiVisibilityRepository';
import { DrizzleSeoGrowthRepository } from '../db/repositories/DrizzleSeoGrowthRepository';
import { IntegrationCredentialVault, maskOf } from '../seo/IntegrationCredentialVault';
import { QueueService, QUEUES } from '../queues/QueueService';
import { createProviderRegistry } from './providers';

/** The existing AES-256-GCM integration vault, adapted to the cipher port. */
export function vaultCipher(): CredentialCipher | null {
  const v = IntegrationCredentialVault.fromEnv();
  if (!v) return null;
  return {
    encrypt: (plaintext) => v.encrypt({ apiKey: plaintext }),
    decrypt: (ciphertext) => String(v.decrypt<{ apiKey: string }>(ciphertext).apiKey ?? ''),
    mask: (plaintext) => maskOf(plaintext),
  };
}

/** Runs execute on their own queue ('ai-visibility'), job name 'aiv-run'. */
export const bullRunQueue: RunQueue = {
  async enqueueRun(runId: string) {
    const q = QueueService.getInstance().getQueue(QUEUES.AI_VISIBILITY);
    if (!q) return false;
    // jobId = run id: BullMQ will not enqueue the same run twice.
    await q.add('aiv-run', { runId }, { jobId: `aiv-run-${runId}`, attempts: 1, removeOnComplete: 100, removeOnFail: 200 });
    return true;
  },
};

/** AI Search alerts land in the existing SEO alert list (seo_alerts), deduped while open. */
export function seoAlertSink(repo = new DrizzleSeoGrowthRepository()): AlertSink {
  return { raise: async (a) => { await repo.raiseAlert(a); } };
}

export function createAiVisibility(audit: CreateAuditLogUseCase) {
  const repo = new DrizzleAiVisibilityRepository();
  const providers = createProviderRegistry();
  const cipher = vaultCipher();
  const setup = new AiVisibilitySetupUseCases(repo, audit, providers, cipher);
  const runs = new AiVisibilityRunUseCases(repo, audit, providers, cipher, bullRunQueue, appLogger, seoAlertSink());
  const insights = new AiVisibilityInsightsUseCases(repo);
  const actions = new AiVisibilityActionUseCases(repo, audit, runs);
  return { repo, setup, runs, insights, actions };
}

export type AiVisibilityServices = ReturnType<typeof createAiVisibility>;
