import { describe, it, expect, vi } from 'vitest';
import { RecordProductFinderActionUseCase } from '../../src/application/use-cases/product-finder/RecordProductFinderActionUseCase';

describe('RecordProductFinderActionUseCase', () => {
  it('records action securely', async () => {
    const mockRepo = {
      getSession: vi.fn().mockResolvedValue({ id: 'sess-1' })
    } as any;

    const mockMeasurement = {
      publishFinderAddToCartIntent: vi.fn().mockResolvedValue(undefined)
    } as any;

    const uc = new RecordProductFinderActionUseCase(mockRepo, mockMeasurement);
    const res = await uc.execute({ sessionId: 'sess-1', action: 'add_to_cart_intent', productId: 'p1' });

    expect(res.success).toBe(true);
    expect(mockMeasurement.publishFinderAddToCartIntent).toHaveBeenCalledWith('sess-1', 'p1');
  });
});
