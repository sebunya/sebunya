import { describe, it, expect, vi } from 'vitest';
import { CapturePurchaseMeasurementUseCase } from '../../src/application/use-cases/measurement/CapturePurchaseMeasurementUseCase';

describe('CapturePurchaseMeasurementUseCase', () => {
  it('verified payment creates canonical purchase event exactly once', async () => {
    const mockRepo = { 
      savePurchaseMeasurementEvent: vi.fn().mockResolvedValue({ ok: true, eventId: 'evt-1', idempotencyKey: 'measurement-ord-1-ref-1' }),
      findPurchaseEventByOrderId: vi.fn().mockResolvedValue(null)
    };
    const uc = new CapturePurchaseMeasurementUseCase(mockRepo as any);
    
    const result = await uc.execute({
      orderId: 'ord-1',
      paymentReference: 'ref-1',
      value: 100,
      currency: 'UGX',
      payloadSummary: {}
    });
    
    expect(result.ok).toBe(true);
    expect(mockRepo.savePurchaseMeasurementEvent).toHaveBeenCalledTimes(1);
    const savedEvent = mockRepo.savePurchaseMeasurementEvent.mock.calls[0][0];
    expect(savedEvent.eventId).toBeDefined();
    expect(savedEvent.idempotencyKey).toBe('pesapal:purchase:ord-1:ref-1');
  });

  it('fails if missing order_id, value, or currency', async () => {
    const mockRepo = { savePurchaseMeasurementEvent: vi.fn() };
    const uc = new CapturePurchaseMeasurementUseCase(mockRepo as any);
    
    await expect(uc.execute({} as any)).rejects.toThrow();
    expect(mockRepo.savePurchaseMeasurementEvent).not.toHaveBeenCalled();
  });

  it('fails for pending or unverified payment state', async () => {
    const mockRepo = { savePurchaseMeasurementEvent: vi.fn() };
    const uc = new CapturePurchaseMeasurementUseCase(mockRepo as any);
    
    await expect(uc.execute({
      orderId: 'ord-1',
      amount: 100,
      currency: 'UGX',
      status: 'PENDING'
    } as any)).rejects.toThrow();
  });
});
