import { describe, it, expect, vi } from 'vitest';
import { RecordControlledActivationApprovalUseCase } from '../../../src/application/use-cases/activation/RecordControlledActivationApprovalUseCase.js';

describe('RecordControlledActivationApprovalUseCase', () => {
  it('cannot approve with critical FAIL', async () => {
    const repo = { getActivationRequest: vi.fn().mockResolvedValue({ rollbackPlanSummary: 'x', monitoringOwner: 'y', requestedWindowStart: new Date(), requestedWindowEnd: new Date() }) } as any;
    const audit = { recordAuditEvent: vi.fn() } as any;
    const policy = { canApproveActivation: vi.fn().mockResolvedValue(true) } as any;
    const checker = { getLatestGates: vi.fn().mockResolvedValue([{ status: 'FAIL', severity: 'CRITICAL' }]) } as any;
    const appRepo = { recordApproval: vi.fn() } as any;

    const uc = new RecordControlledActivationApprovalUseCase(repo, audit, policy, checker, appRepo);

    await expect(uc.execute({ adminId: 'a', activationRequestId: 'req', approvalNote: 'ok' })).rejects.toThrow('Cannot approve with critical FAIL gates');
  });

  it('cannot approve with BLOCKED gate', async () => {
    const repo = { getActivationRequest: vi.fn().mockResolvedValue({ rollbackPlanSummary: 'x', monitoringOwner: 'y', requestedWindowStart: new Date(), requestedWindowEnd: new Date() }) } as any;
    const audit = { recordAuditEvent: vi.fn() } as any;
    const policy = { canApproveActivation: vi.fn().mockResolvedValue(true) } as any;
    const checker = { getLatestGates: vi.fn().mockResolvedValue([{ status: 'BLOCKED' }]) } as any;
    const appRepo = { recordApproval: vi.fn() } as any;

    const uc = new RecordControlledActivationApprovalUseCase(repo, audit, policy, checker, appRepo);

    await expect(uc.execute({ adminId: 'a', activationRequestId: 'req', approvalNote: 'ok' })).rejects.toThrow('Cannot approve with BLOCKED gates');
  });

  it('approval records audit only and does not launch anything', async () => {
    const repo = { getActivationRequest: vi.fn().mockResolvedValue({ id: 'req', rollbackPlanSummary: 'x', monitoringOwner: 'y', requestedWindowStart: new Date(), requestedWindowEnd: new Date() }), updateActivationRequestStatus: vi.fn() } as any;
    const audit = { recordAuditEvent: vi.fn() } as any;
    const policy = { canApproveActivation: vi.fn().mockResolvedValue(true) } as any;
    const checker = { getLatestGates: vi.fn().mockResolvedValue([{ status: 'PASS', severity: 'INFO' }]) } as any;
    const appRepo = { recordApproval: vi.fn() } as any;

    const uc = new RecordControlledActivationApprovalUseCase(repo, audit, policy, checker, appRepo);

    await uc.execute({ adminId: 'a', activationRequestId: 'req', approvalNote: 'ok' });
    expect(appRepo.recordApproval).toHaveBeenCalled();
    expect(repo.updateActivationRequestStatus).toHaveBeenCalled();
  });
});
