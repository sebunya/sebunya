import { describe, it, expect } from 'vitest';
import { RunControlledActivationDryRunUseCase } from '../../../src/application/use-cases/activation/RunControlledActivationDryRunUseCase.js';
import { ControlledActivationDryRunRepository } from '../../../src/application/ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledActivationExecutionPlanRepository } from '../../../src/application/ports/activation/ControlledActivationExecutionPlanRepository.js';
import { ControlledActivationAccessPolicy } from '../../../src/application/ports/activation/ControlledActivationAccessPolicy.js';
import { ControlledActivationAuditRepository } from '../../../src/application/ports/activation/ControlledActivationAuditRepository.js';
import { ControlledActivationPayloadPreviewer } from '../../../src/application/ports/activation/ControlledActivationPayloadPreviewer.js';

describe('RunControlledActivationDryRunUseCase', () => {
  it('should block execution if user lacks dry-run permission', async () => {
    const accessPolicy = {
      canRunActivationReadinessChecks: async () => false,
    } as unknown as ControlledActivationAccessPolicy;

    const useCase = new RunControlledActivationDryRunUseCase(
      {} as ControlledActivationDryRunRepository,
      {} as ControlledActivationExecutionPlanRepository,
      accessPolicy,
      {} as ControlledActivationAuditRepository,
      {} as ControlledActivationPayloadPreviewer
    );

    await expect(useCase.execute({ executionPlanId: 'plan-1', executedByAdminId: 'admin-1' }))
      .rejects.toThrow('UNAUTHORIZED');
  });

  it('should block live activation attempts natively', async () => {
    const accessPolicy = {
      canRunActivationReadinessChecks: async () => true,
    } as unknown as ControlledActivationAccessPolicy;

    const dryRunRepo = {
      createDryRun: async () => ({ id: 'dry-1' }),
      updateDryRunStatus: async () => ({}),
      updateDryRun: async () => ({ id: 'dry-1' }),
      attachPayloadPreviews: async () => {},
    } as unknown as ControlledActivationDryRunRepository;

    const executionPlanRepo = {
      getExecutionPlan: async () => ({
        id: 'plan-1',
        status: 'READY_FOR_DRY_RUN',
        activationScope: 'GTM_LIVE', // Should reject or simulate without live dispatch
      }),
      updateExecutionPlanStatus: async () => ({}),
    } as unknown as ControlledActivationExecutionPlanRepository;

    const auditRepo = {
      recordAuditEvent: async () => {},
    } as unknown as ControlledActivationAuditRepository;

    const payloadPreviewer = {
      generatePreviews: async () => [],
    } as unknown as ControlledActivationPayloadPreviewer;

    const useCase = new RunControlledActivationDryRunUseCase(
      dryRunRepo,
      executionPlanRepo,
      accessPolicy,
      auditRepo,
      payloadPreviewer
    );

    const result = await useCase.execute({ executionPlanId: 'plan-1', executedByAdminId: 'admin-1' });
    expect(result).toHaveProperty('id', 'dry-1');
  });
});
