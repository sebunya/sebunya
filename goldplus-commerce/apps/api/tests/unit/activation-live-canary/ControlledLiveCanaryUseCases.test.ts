import { describe, it, expect } from 'vitest';
import { CreateControlledLiveCanaryUseCase } from '../../../src/application/use-cases/activation/CreateControlledLiveCanaryUseCase.js';
import { EvaluateControlledLiveCanaryEligibilityUseCase } from '../../../src/application/use-cases/activation/EvaluateControlledLiveCanaryEligibilityUseCase.js';
import { StartControlledLiveCanaryUseCase } from '../../../src/application/use-cases/activation/StartControlledLiveCanaryUseCase.js';
import { PauseControlledLiveCanaryUseCase } from '../../../src/application/use-cases/activation/PauseControlledLiveCanaryUseCase.js';
import { RollbackControlledLiveCanaryUseCase } from '../../../src/application/use-cases/activation/RollbackControlledLiveCanaryUseCase.js';
import { CompleteControlledLiveCanaryUseCase } from '../../../src/application/use-cases/activation/CompleteControlledLiveCanaryUseCase.js';
import { BuildControlledLiveCanaryEvidencePackUseCase } from '../../../src/application/use-cases/activation/BuildControlledLiveCanaryEvidencePackUseCase.js';

import { ControlledLiveCanaryRepository } from '../../../src/application/ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledActivationDryRunRepository } from '../../../src/application/ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledActivationAccessPolicy } from '../../../src/application/ports/activation/ControlledActivationAccessPolicy.js';
import { ControlledLiveCanaryKillSwitch } from '../../../src/application/ports/activation/ControlledLiveCanaryKillSwitch.js';
import { ControlledLiveCanaryTransport } from '../../../src/application/ports/activation/ControlledLiveCanaryTransport.js';
import { ControlledLiveCanaryAuditRepository } from '../../../src/application/ports/activation/ControlledLiveCanaryAuditRepository.js';
import { ControlledLiveCanaryEvidenceBuilder } from '../../../src/application/ports/activation/ControlledLiveCanaryEvidenceBuilder.js';

describe('Controlled Live Canary Use Cases', () => {
  const dummyCanary = {
    id: 'canary-123',
    dryRunId: 'dry-123',
    activationRequestId: 'req-123',
    status: 'DRAFT' as const,
    canaryCap: 10,
    destinationAllowlist: ['meta'],
    rollbackPlan: 'disable-flag',
    monitoringOwner: 'sre-team',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockCanaryRepo = {
    createCanary: async (c: any) => ({ ...c, createdAt: new Date(), updatedAt: new Date() }),
    updateCanary: async (id: string, updates: any) => ({ ...dummyCanary, ...updates }),
    getCanary: async () => dummyCanary,
    getCanariesForRequest: async () => [dummyCanary]
  } as unknown as ControlledLiveCanaryRepository;

  const mockDryRunRepo = {
    getDryRun: async () => ({
      id: 'dry-123',
      status: 'PASSED',
      redactedEvidenceRef: 'evidence-123'
    }),
    createDryRun: async () => ({ id: 'dry-123' }),
    updateDryRun: async () => ({ id: 'dry-123' }),
    getDryRunsForPlan: async () => []
  } as unknown as ControlledActivationDryRunRepository;

  const mockAccessPolicy = {
    canRunActivationReadinessChecks: async () => true
  } as unknown as ControlledActivationAccessPolicy;

  const mockKillSwitch = {
    isKillSwitchTriggered: async () => false
  } as unknown as ControlledLiveCanaryKillSwitch;

  const mockTransport = {
    sendCanary: async () => ({
      id: 'attempt-123',
      status: 'NOT_CONFIGURED',
      redactedPayloadSummary: 'payload',
      redactedResponseSummary: 'response',
      attemptedAt: new Date()
    })
  } as unknown as ControlledLiveCanaryTransport;

  const mockAuditRepo = {
    recordAuditEvent: async (e: any) => ({ ...e, timestamp: new Date() }),
    getAuditEventsForCanary: async () => []
  } as unknown as ControlledLiveCanaryAuditRepository;

  const mockEvidenceBuilder = {
    buildEvidencePack: async () => ({
      id: 'ev-123',
      canaryId: 'canary-123',
      eligibilitySummary: '',
      deliveryAttemptSummary: '',
      consentSummary: '',
      destinationSummary: '',
      rollbackSummary: '',
      monitoringSummary: '',
      createdAt: new Date()
    })
  } as unknown as ControlledLiveCanaryEvidenceBuilder;

  it('cannot create canary if user is unauthorized', async () => {
    const unauthorizedPolicy = {
      canRunActivationReadinessChecks: async () => false
    } as unknown as ControlledActivationAccessPolicy;

    const useCase = new CreateControlledLiveCanaryUseCase(mockCanaryRepo, mockDryRunRepo, unauthorizedPolicy);
    await expect(useCase.execute({
      dryRunId: 'dry-123',
      activationRequestId: 'req-123',
      canaryCap: 10,
      destinationAllowlist: ['meta'],
      rollbackPlan: 'disable-flag',
      monitoringOwner: 'sre-team',
      createdByAdminId: 'admin-1'
    })).rejects.toThrow('UNAUTHORIZED');
  });

  it('cannot create canary without dry-run passed', async () => {
    const failedDryRunRepo = {
      getDryRun: async () => ({
        id: 'dry-123',
        status: 'FAILED',
        redactedEvidenceRef: 'evidence-123'
      })
    } as unknown as ControlledActivationDryRunRepository;

    const useCase = new CreateControlledLiveCanaryUseCase(mockCanaryRepo, failedDryRunRepo, mockAccessPolicy);
    await expect(useCase.execute({
      dryRunId: 'dry-123',
      activationRequestId: 'req-123',
      canaryCap: 10,
      destinationAllowlist: ['meta'],
      rollbackPlan: 'disable-flag',
      monitoringOwner: 'sre-team',
      createdByAdminId: 'admin-1'
    })).rejects.toThrow('DRY_RUN_NOT_PASSED');
  });

  it('cannot start without READY_FOR_CANARY eligibility', async () => {
    const draftCanaryRepo = {
      getCanary: async () => ({ ...dummyCanary, status: 'DRAFT' }),
      updateCanary: async () => ({ ...dummyCanary })
    } as unknown as ControlledLiveCanaryRepository;

    const useCase = new StartControlledLiveCanaryUseCase(draftCanaryRepo, mockTransport, mockKillSwitch, mockAuditRepo);
    await expect(useCase.execute({
      canaryId: 'canary-123',
      confirmationText: 'START_CONTROLLED_CANARY',
      startedByAdminId: 'admin-1'
    })).rejects.toThrow('CANARY_NOT_ELIGIBLE');
  });

  it('cannot start when confirmation text is invalid', async () => {
    const useCase = new StartControlledLiveCanaryUseCase(mockCanaryRepo, mockTransport, mockKillSwitch, mockAuditRepo);
    await expect(useCase.execute({
      canaryId: 'canary-123',
      confirmationText: 'INVALID_TEXT',
      startedByAdminId: 'admin-1'
    })).rejects.toThrow('INVALID_CONFIRMATION_TEXT');
  });

  it('cannot start when kill switch is triggered', async () => {
    const eligibleCanaryRepo = {
      getCanary: async () => ({ ...dummyCanary, status: 'READY_FOR_CANARY' }),
      updateCanary: async (id: string, updates: any) => ({ ...dummyCanary, ...updates })
    } as unknown as ControlledLiveCanaryRepository;

    const triggeredKillSwitch = {
      isKillSwitchTriggered: async () => true
    } as unknown as ControlledLiveCanaryKillSwitch;

    const useCase = new StartControlledLiveCanaryUseCase(eligibleCanaryRepo, mockTransport, triggeredKillSwitch, mockAuditRepo);
    await expect(useCase.execute({
      canaryId: 'canary-123',
      confirmationText: 'START_CONTROLLED_CANARY',
      startedByAdminId: 'admin-1'
    })).rejects.toThrow('KILL_SWITCH_BLOCKED');
  });

  it('evaluates eligibility and blocks if kill switch is triggered', async () => {
    const triggeredKillSwitch = {
      isKillSwitchTriggered: async () => true
    } as unknown as ControlledLiveCanaryKillSwitch;

    const useCase = new EvaluateControlledLiveCanaryEligibilityUseCase(mockCanaryRepo, mockDryRunRepo, triggeredKillSwitch);
    const result = await useCase.execute({ canaryId: 'canary-123' });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('BLOCKED');
  });

  it('pauses running canary', async () => {
    const runningCanaryRepo = {
      getCanary: async () => ({ ...dummyCanary, status: 'CANARY_RUNNING' }),
      updateCanary: async (id: string, updates: any) => ({ ...dummyCanary, ...updates })
    } as unknown as ControlledLiveCanaryRepository;

    const useCase = new PauseControlledLiveCanaryUseCase(runningCanaryRepo, mockAuditRepo);
    const result = await useCase.execute({
      canaryId: 'canary-123',
      reason: 'Pause test',
      pausedByAdminId: 'admin-1'
    });
    expect(result.status).toBe('CANARY_PAUSED');
  });

  it('rolls back canary', async () => {
    const useCase = new RollbackControlledLiveCanaryUseCase(mockCanaryRepo, mockAuditRepo);
    const result = await useCase.execute({
      canaryId: 'canary-123',
      reason: 'Rollback test',
      rollbackOwner: 'admin-devops',
      actorAdminId: 'admin-1'
    });
    expect(result.status).toBe('CANARY_ROLLED_BACK');
    expect(result.rollbackReason).toBe('Rollback test');
  });

  it('completes canary without full launch', async () => {
    const runningCanaryRepo = {
      getCanary: async () => ({ ...dummyCanary, status: 'CANARY_RUNNING' }),
      updateCanary: async (id: string, updates: any) => ({ ...dummyCanary, ...updates })
    } as unknown as ControlledLiveCanaryRepository;

    const useCase = new CompleteControlledLiveCanaryUseCase(runningCanaryRepo, mockAuditRepo);
    const result = await useCase.execute({
      canaryId: 'canary-123',
      completedByAdminId: 'admin-1'
    });
    expect(result.status).toBe('CANARY_COMPLETED');
  });
});
