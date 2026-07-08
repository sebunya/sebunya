import { describe, it, expect, vi } from 'vitest';
import { LinkPaymentToAttributionTouchpointsUseCase } from '../../src/application/use-cases/measurement/LinkPaymentToAttributionTouchpointsUseCase';

describe('LinkPaymentToAttributionTouchpointsUseCase', () => {
  it('links payment to existing attribution touchpoints', async () => {
    const mockRepo = { 
      linkPaymentToTouchpoints: vi.fn().mockResolvedValue([{ id: 'touch-1' }, { id: 'touch-2' }]),
      getAttributionSummaryForPayment: vi.fn().mockResolvedValue({ touchpoints: [{ id: 'touch-1' }, { id: 'touch-2' }] })
    };
    const uc = new LinkPaymentToAttributionTouchpointsUseCase(mockRepo as any);
    
    const result = await uc.execute({ orderId: 'ord-1', paymentReference: 'ref-1' });
    expect(result.touchpoints.length).toBe(2);
    expect(mockRepo.linkPaymentToTouchpoints).toHaveBeenCalledWith('ord-1', 'ref-1');
  });

  it('no touchpoints returns safe empty result', async () => {
    const mockRepo = { 
      linkPaymentToTouchpoints: vi.fn().mockResolvedValue([]),
      getAttributionSummaryForPayment: vi.fn().mockResolvedValue({ touchpoints: [] })
    };
    const uc = new LinkPaymentToAttributionTouchpointsUseCase(mockRepo as any);
    const result = await uc.execute({ orderId: 'ord-empty', paymentReference: 'ref-1' });
    expect(result.touchpoints).toEqual([]);
  });

  it('repository failure is handled safely', async () => {
    const mockRepo = { linkPaymentToTouchpoints: vi.fn().mockRejectedValue(new Error('DB failure')) };
    const uc = new LinkPaymentToAttributionTouchpointsUseCase(mockRepo as any);
    // Should swallow error and return empty array to not break purchase capture
    const result = await uc.execute({ orderId: 'ord-err', paymentReference: 'ref-err' });
    expect(result.touchpoints).toEqual([]);
  });
});
