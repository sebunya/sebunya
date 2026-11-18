import type { CreditNoticeSender } from '../../application/use-cases/credit/CreditUseCases';
import type { CustomerOutboxNotifier } from './CustomerOutboxNotifier';

/**
 * 0196: card messages that never carry the code (card used by someone else's
 * order; a week before expiry), queued as customer messages so consent and
 * the live-send switch apply as to every other.
 *
 * Moved out of the Registry, 2026-11: the outbox entry is exactly the one the
 * Registry built.
 */
export class OutboxCreditNoticeSender implements CreditNoticeSender {
  constructor(private readonly customerOutboxNotifier: Pick<CustomerOutboxNotifier, 'enqueue'>) {}

  async send(input: { template: 'CREDIT_USED' | 'CREDIT_EXPIRING'; instrumentId: string; phone: string; idempotencyKey: string; data: Record<string, unknown> }) {
    await this.customerOutboxNotifier.enqueue({
      eventType: 'CUSTOMER_ORDER_MESSAGE', template: input.template, customerPhone: input.phone, customerEmail: null, data: input.data,
      idempotencyKey: input.idempotencyKey, relatedEntity: 'credit_instrument', relatedEntityId: input.instrumentId,
    });
  }
}
