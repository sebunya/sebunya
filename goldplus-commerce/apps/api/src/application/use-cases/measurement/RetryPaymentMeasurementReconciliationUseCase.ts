import { IPaymentMeasurementRepository, PaymentMeasurementReconciliation } from '../../ports/measurement/PaymentMeasurementRepository';
import { IPurchaseMeasurementQueue } from '../../ports/measurement/PurchaseMeasurementQueue';

export interface RetryPaymentMeasurementReconciliationInput {
  orderId: string;
}

export class RetryPaymentMeasurementReconciliationUseCase {
  constructor(
    private readonly paymentRepo: IPaymentMeasurementRepository,
    private readonly queue: IPurchaseMeasurementQueue
  ) {}

  async execute(input: RetryPaymentMeasurementReconciliationInput): Promise<PaymentMeasurementReconciliation> {
    if (!input.orderId) {
      throw new Error('MISSING_ORDER_ID');
    }

    const reconciliation = await this.paymentRepo.getReconciliationByOrderId(input.orderId);
    if (!reconciliation) {
      throw new Error('RECONCILIATION_NOT_FOUND');
    }

    const unretriableStatuses = ['PURCHASE_EVENT_QUEUED', 'VERIFIED_PURCHASE_CAPTURED', 'DUPLICATE_PURCHASE_IGNORED'];
    if (unretriableStatuses.includes(reconciliation.status)) {
      throw new Error(`RETRY_NOT_ALLOWED: Status is ${reconciliation.status}`);
    }

    const purchaseEvent = await this.paymentRepo.findPurchaseEventByOrderId(input.orderId);
    if (!purchaseEvent) {
      throw new Error('RETRY_NOT_ALLOWED: No purchase event captured yet. Cannot retry queueing.');
    }

    // Attempt to queue
    const enqueued = await this.queue.enqueuePurchaseRetry({
      orderId: purchaseEvent.orderId,
      paymentReference: purchaseEvent.paymentReference,
      eventId: purchaseEvent.eventId,
      idempotencyKey: purchaseEvent.idempotencyKey
    });

    const newStatus = enqueued ? 'RETRY_QUEUED' : 'FAILED';
    return await this.paymentRepo.updateReconciliationStatus(reconciliation.id, newStatus);
  }
}
