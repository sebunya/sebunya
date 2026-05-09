import { DOMAIN_EVENTS } from '@goldplus/shared';

export class PaymentIdempotencyService {
  constructor(
    private readonly eventPublisher: IEventPublisher
  ) {}

  public async processWebhook(
    payload: { provider: string; idempotencyKey: string; orderId: string; amount: number; status: string }
  ): Promise<void> {
    // 1. Check if idempotencyKey exists in outbox/events
    // Implementation abstracted for Phase 1 MVP
    
    // 2. Process payment status
    if (payload.status === 'SUCCESS') {
      await this.eventPublisher.publish(DOMAIN_EVENTS.PAYMENT_SUCCESS, payload);
    } else {
      await this.eventPublisher.publish(DOMAIN_EVENTS.PAYMENT_FAILED, payload);
    }
  }
}

export interface IEventPublisher {
  publish(eventType: string, payload: any): Promise<void>;
}
