import { describe, it, expect, vi } from 'vitest';
import { CreateControlledActivationRequestUseCase } from '../../../src/application/use-cases/activation/CreateControlledActivationRequestUseCase.js';

describe('CreateControlledActivationRequestUseCase', () => {
  it('requires reason', async () => {
    const repo = { createActivationRequest: vi.fn() } as any;
    const audit = { recordAuditEvent: vi.fn() } as any;
    const policy = { canCreateActivationRequest: vi.fn().mockResolvedValue(true) } as any;
    const uc = new CreateControlledActivationRequestUseCase(repo, audit, policy);

    await expect(uc.execute({
      adminId: 'admin', activationName: 'test', activationScope: 'GTM_DRAFT_READINESS', environment: 'STAGING', reason: '', rollbackPlanSummary: 'plan', monitoringOwner: 'owner'
    })).rejects.toThrow('Reason is required');
  });

  it('requires rollback summary', async () => {
    const repo = { createActivationRequest: vi.fn() } as any;
    const audit = { recordAuditEvent: vi.fn() } as any;
    const policy = { canCreateActivationRequest: vi.fn().mockResolvedValue(true) } as any;
    const uc = new CreateControlledActivationRequestUseCase(repo, audit, policy);

    await expect(uc.execute({
      adminId: 'admin', activationName: 'test', activationScope: 'GTM_DRAFT_READINESS', environment: 'STAGING', reason: 'reason', rollbackPlanSummary: '', monitoringOwner: 'owner'
    })).rejects.toThrow('Rollback plan summary is required');
  });

  it('creates DRAFT without launching anything', async () => {
    const repo = { createActivationRequest: vi.fn().mockResolvedValue({ id: 'req', status: 'DRAFT', activationScope: 'GTM_DRAFT_READINESS' }) } as any;
    const audit = { recordAuditEvent: vi.fn() } as any;
    const policy = { canCreateActivationRequest: vi.fn().mockResolvedValue(true) } as any;
    const uc = new CreateControlledActivationRequestUseCase(repo, audit, policy);

    const res = await uc.execute({
      adminId: 'admin', activationName: 'test', activationScope: 'GTM_DRAFT_READINESS', environment: 'STAGING', reason: 'reason', rollbackPlanSummary: 'plan', monitoringOwner: 'owner'
    });
    
    expect(res.status).toBe('DRAFT');
    expect(repo.createActivationRequest).toHaveBeenCalled();
    expect(audit.recordAuditEvent).toHaveBeenCalled();
  });
});
