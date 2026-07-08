import { describe, it, expect, vi } from 'vitest';
import { ReconcilePesapalOrderMeasurementUseCase } from '../../src/application/use-cases/measurement/ReconcilePesapalOrderMeasurementUseCase';

describe('ReconcilePesapalOrderMeasurementUseCase', () => {
  it('captures purchase successfully for verified payment', async () => {
    const mockRepo = { 
      findReconciliationByOrderId: vi.fn().mockResolvedValue(null),
      createReconciliation: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      updateReconciliationStatus: vi.fn().mockResolvedValue(null)
    };
    const mockCapture = { execute: vi.fn().mockResolvedValue({ ok: true, eventId: 'evt', idempotencyKey: 'key', orderId: 'ord-1', paymentReference: 'ref-1' }) };
    const mockConsent = { canSendPaidSocialEvent: vi.fn().mockReturnValue(true) };
    const mockQueue = { enqueuePurchaseMeasurement: vi.fn().mockResolvedValue(true) };
    const mockLink = { execute: vi.fn().mockResolvedValue([]) };
    const mockLogger = { info: vi.fn() };
    
    const uc = new ReconcilePesapalOrderMeasurementUseCase(
      mockRepo as any, mockCapture as any, mockLink as any, mockQueue as any, mockConsent as any, mockLogger as any
    );
    
    const result = await uc.execute({
      orderId: 'ord-1',
      paymentReference: 'ref-1',
      pesapalTrackingId: 'trk-1',
      amount: 100,
      currency: 'UGX',
      status: 'completed'
    });
    
    expect(result.status).toBe('PURCHASE_EVENT_QUEUED');
    expect(mockRepo.createReconciliation).toHaveBeenCalled();
    expect(mockQueue.enqueuePurchaseMeasurement).toHaveBeenCalled();
  });

  it('duplicate order_id, payment_reference, or pesapal_tracking_id returns DUPLICATE_PURCHASE_IGNORED', async () => {
    const mockRepo = { 
      findReconciliationByOrderId: vi.fn().mockResolvedValue({ id: 'rec-1', status: 'PURCHASE_EVENT_QUEUED' }),
      createReconciliation: vi.fn(),
      markDuplicateIgnored: vi.fn()
    };
    const mockLogger = { info: vi.fn() };
    const uc = new ReconcilePesapalOrderMeasurementUseCase(mockRepo as any, {} as any, {} as any, {} as any, {} as any, mockLogger as any);
    
    const result = await uc.execute({ orderId: 'ord-1', status: 'completed' } as any);
    expect(result.status).toBe('DUPLICATE_PURCHASE_IGNORED');
    expect(mockRepo.markDuplicateIgnored).toHaveBeenCalled();
    expect(mockRepo.createReconciliation).not.toHaveBeenCalled();
  });

  it('missing, denied, or withdrawn advertising consent returns BLOCKED_BY_CONSENT', async () => {
    const mockRepo = { findReconciliationByOrderId: vi.fn().mockResolvedValue(null), createReconciliation: vi.fn().mockResolvedValue({ id: 'rec-1' }), updateReconciliationStatus: vi.fn() };
    const mockCapture = { execute: vi.fn().mockResolvedValue({ ok: true, eventId: 'evt', idempotencyKey: 'key', orderId: 'ord-1', paymentReference: 'ref-1' }) };
    const mockConsent = { canSendPaidSocialEvent: vi.fn().mockReturnValue(false) }; // DENIED
    const mockLogger = { info: vi.fn() };
    
    const uc = new ReconcilePesapalOrderMeasurementUseCase(mockRepo as any, mockCapture as any, { execute: vi.fn() } as any, {} as any, mockConsent as any, mockLogger as any);
    
    const result = await uc.execute({ orderId: 'ord-1', amount: 100, currency: 'UGX', status: 'completed' } as any);
    expect(result.status).toBe('BLOCKED_BY_CONSENT');
    expect(mockRepo.updateReconciliationStatus).toHaveBeenCalledWith('rec-1', 'BLOCKED_BY_CONSENT');
  });
});
