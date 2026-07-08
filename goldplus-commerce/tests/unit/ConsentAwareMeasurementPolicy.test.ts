import { describe, it, expect, vi } from 'vitest';
import { ConsentAwareMeasurementPolicy } from '../../apps/api/src/infrastructure/measurement/ConsentAwareMeasurementPolicy';
import { ConsentService } from '../../apps/api/src/application/use-cases/measurement/ConsentService';

describe('ConsentAwareMeasurementPolicy', () => {
  it('allows if both analytics and advertising are true', async () => {
    const mockConsentService = {
      getCurrentState: vi.fn().mockResolvedValue({ analytics: true, advertising: true })
    } as unknown as ConsentService;
    
    const policy = new ConsentAwareMeasurementPolicy(mockConsentService);
    const result = await policy.canSendPaidSocialEvent('user1', 'session1');
    expect(result).toBe(true);
  });

  it('blocks if advertising is false', async () => {
    const mockConsentService = {
      getCurrentState: vi.fn().mockResolvedValue({ analytics: true, advertising: false })
    } as unknown as ConsentService;
    
    const policy = new ConsentAwareMeasurementPolicy(mockConsentService);
    const result = await policy.canSendPaidSocialEvent('user1', 'session1');
    expect(result).toBe(false);
  });
});
