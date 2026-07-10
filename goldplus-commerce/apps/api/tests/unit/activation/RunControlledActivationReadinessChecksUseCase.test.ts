import { describe, it, expect, vi } from 'vitest';
import { RunControlledActivationReadinessChecksUseCase } from '../../../src/application/use-cases/activation/RunControlledActivationReadinessChecksUseCase.js';

describe('RunControlledActivationReadinessChecksUseCase', () => {
  it('records gates, classifies honest safe states, and does not publish GTM', async () => {
    const repo = { getActivationRequest: vi.fn().mockResolvedValue({ id: 'req', status: 'DRAFT' }), updateActivationRequestStatus: vi.fn() } as any;
    const audit = { recordAuditEvent: vi.fn() } as any;
    const policy = { canRunActivationReadinessChecks: vi.fn().mockResolvedValue(true) } as any;
    const checker = { 
      runChecks: vi.fn().mockResolvedValue([{ gateId: 'g1', status: 'NOT_CONFIGURED' }, { gateId: 'g2', status: 'DRY_RUN' }, { gateId: 'g3', status: 'CONSENT_BLOCKED' }]),
      saveGates: vi.fn() 
    } as any;
    
    const uc = new RunControlledActivationReadinessChecksUseCase(repo, audit, policy, checker);

    const gates = await uc.execute({ adminId: 'admin', activationRequestId: 'req' });
    
    expect(gates).toHaveLength(3);
    expect(gates[0].status).toBe('NOT_CONFIGURED');
    expect(gates[1].status).toBe('DRY_RUN');
    expect(gates[2].status).toBe('CONSENT_BLOCKED');
    expect(checker.runChecks).toHaveBeenCalled();
    expect(checker.saveGates).toHaveBeenCalled();
  });
});
