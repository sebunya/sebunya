import { FulfilmentTask, FulfilmentPaymentStatus } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';

/**
 * PaymentConfirmed / payment-state change → update the existing admin alert so
 * the order becomes ready for preparation. Idempotent: re-applying the same
 * payment status is a no-op, so duplicate provider callbacks never duplicate
 * effects. Never creates a task (that is the OrderPlaced path's job).
 */
export class MarkFulfilmentPaymentConfirmedUseCase {
  constructor(private readonly repo: IFulfilmentRepository) {}

  async execute(orderId: string, paymentStatus: FulfilmentPaymentStatus = 'paid'): Promise<{ updated: boolean }> {
    if (!orderId) return { updated: false };
    const snapshot = await this.repo.findByOrderId(orderId);
    if (!snapshot) return { updated: false };

    const task = FulfilmentTask.rehydrate(snapshot);
    const changed = task.applyPaymentStatus(paymentStatus);
    if (!changed) return { updated: false };

    await this.repo.update(task);
    return { updated: true };
  }
}
