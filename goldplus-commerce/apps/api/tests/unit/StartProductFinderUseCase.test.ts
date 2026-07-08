import { describe, it, expect, vi } from 'vitest';
import { StartProductFinderUseCase } from '../../src/application/use-cases/product-finder/StartProductFinderUseCase';

describe('StartProductFinderUseCase', () => {
  it('creates session and emits measurement event safely', async () => {
    const mockRepo = {
      createSession: vi.fn().mockResolvedValue({ id: 'sess-123' })
    } as any;
    
    const mockMeasurement = {
      publishFinderStarted: vi.fn().mockResolvedValue(undefined)
    } as any;

    const uc = new StartProductFinderUseCase(mockRepo, mockMeasurement);
    
    const res = await uc.execute({ userId: 'u1', anonymousId: 'a1' });
    
    expect(res.sessionId).toBe('sess-123');
    expect(mockRepo.createSession).toHaveBeenCalledWith({ userId: 'u1', anonymousId: 'a1', status: 'FINDER_STARTED' });
    expect(mockMeasurement.publishFinderStarted).toHaveBeenCalledWith('sess-123', 'u1', 'a1');
  });
});
