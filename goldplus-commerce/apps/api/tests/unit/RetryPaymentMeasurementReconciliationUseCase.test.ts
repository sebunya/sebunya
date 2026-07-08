import { describe, it, expect, vi } from 'vitest';
import { RetryPaymentMeasurementReconciliationUseCase } from '../../src/application/use-cases/measurement/RetryPaymentMeasurementReconciliationUseCase';

describe('RetryPaymentMeasurementReconciliationUseCase', () => {
  it('failed reconciliation can be retried exactly once', async () => {
    const mockRepo = { 
      getReconciliationByOrderId: vi.fn().mockResolvedValue({ id: 'rec-1', status: 'FAILED', orderId: 'ord-1' }),
      findPurchaseEventByOrderId: vi.fn().mockResolvedValue({ orderId: 'ord-1', paymentReference: 'ref-1', eventId: 'evt', idempotencyKey: 'key' }),
      updateReconciliationStatus: vi.fn().mockResolvedValue({ status: 'RETRY_QUEUED' })
    };
    const mockQueue = { enqueuePurchaseRetry: vi.fn().mockResolvedValue(true) };
    const uc = new RetryPaymentMeasurementReconciliationUseCase(mockRepo as any, mockQueue as any);
    
    const result = await uc.execute({ orderId: 'ord-1' });
    expect(result.status).toBe('RETRY_QUEUED');
    expect(mockQueue.enqueuePurchaseRetry).toHaveBeenCalledTimes(1);
  });

  it('missing reconciliation returns RECONCILIATION_NOT_FOUND', async () => {
    const mockRepo = { getReconciliationByOrderId: vi.fn().mockResolvedValue(null) };
    const uc = new RetryPaymentMeasurementReconciliationUseCase(mockRepo as any, {} as any);
    await expect(uc.execute({ orderId: 'ord-1' })).rejects.toThrow('RECONCILIATION_NOT_FOUND');
  });

  it('already routed reconciliation cannot be retried', async () => {
    const mockRepo = { getReconciliationByOrderId: vi.fn().mockResolvedValue({ status: 'PURCHASE_EVENT_QUEUED' }) };
    const uc = new RetryPaymentMeasurementReconciliationUseCase(mockRepo as any, {} as any);
    await expect(uc.execute({ orderId: 'ord-1' })).rejects.toThrow('RETRY_NOT_ALLOWED');
  });
});
