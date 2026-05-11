export type PaymentWebhookOutcome = 'SUCCESS' | 'FAILED';

export interface RecordedPayment {
  id: string;
  orderId: string;
  idempotencyKey: string;
  provider: string;
  providerReference: string | null;
  amount: number;
  status: PaymentWebhookOutcome;
  paidAt: Date | null;
}

export interface IPaymentRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<RecordedPayment | null>;

  /**
   * Records the webhook outcome and updates the order status atomically.
   * Also writes the corresponding outbox event in the same transaction.
   * Throws if orderId does not exist. Relies on idempotency_key UNIQUE
   * for safe replays: callers must catch UniqueViolation and re-read.
   */
  recordWebhookOutcome(input: {
    orderId: string;
    idempotencyKey: string;
    provider: string;
    providerReference: string | null;
    amount: number;
    outcome: PaymentWebhookOutcome;
  }): Promise<RecordedPayment>;
}
