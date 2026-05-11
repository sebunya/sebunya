import { IPaymentRepository, PaymentWebhookOutcome, RecordedPayment } from '../../ports/IPaymentRepository';

export type PaymentProvider = 'mtn' | 'airtel';
const ALLOWED_PROVIDERS: ReadonlySet<PaymentProvider> = new Set<PaymentProvider>(['mtn', 'airtel']);

export interface RecordPaymentWebhookInput {
  provider: string;
  orderId: string;
  providerReference: string | null;
  amount: number;
  outcome: PaymentWebhookOutcome;
  /**
   * Idempotency key provided by the caller (header or payload). If absent,
   * the use case derives one from `${provider}:${providerReference}`. If
   * neither is usable the use case refuses to proceed — never silently
   * accept a webhook that cannot be deduplicated.
   */
  idempotencyKey?: string | null;
  signatureVerified: boolean;
}

export type RecordPaymentWebhookResult =
  | { ok: true; payment: RecordedPayment; replay: boolean; signatureVerified: boolean }
  | { ok: false; code: 'UNKNOWN_PROVIDER' | 'BAD_AMOUNT' | 'BAD_OUTCOME' | 'MISSING_IDEMPOTENCY' | 'MISSING_ORDER'; message: string };

export class RecordPaymentWebhookUseCase {
  constructor(private readonly payments: IPaymentRepository) {}

  public async execute(input: RecordPaymentWebhookInput): Promise<RecordPaymentWebhookResult> {
    if (!ALLOWED_PROVIDERS.has(input.provider as PaymentProvider)) {
      return { ok: false, code: 'UNKNOWN_PROVIDER', message: `Provider "${input.provider}" is not enabled.` };
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      return { ok: false, code: 'BAD_AMOUNT', message: 'Amount must be a positive integer (UGX, no decimals).' };
    }
    if (input.outcome !== 'SUCCESS' && input.outcome !== 'FAILED') {
      return { ok: false, code: 'BAD_OUTCOME', message: `Outcome must be SUCCESS or FAILED, got "${input.outcome}".` };
    }
    if (!input.orderId || !input.orderId.trim()) {
      return { ok: false, code: 'MISSING_ORDER', message: 'orderId is required.' };
    }

    const idempotencyKey =
      (input.idempotencyKey && input.idempotencyKey.trim()) ||
      (input.providerReference ? `${input.provider}:${input.providerReference}` : '');

    if (!idempotencyKey) {
      return {
        ok: false,
        code: 'MISSING_IDEMPOTENCY',
        message: 'Either Idempotency-Key header or providerReference body field is required.',
      };
    }

    const existing = await this.payments.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { ok: true, payment: existing, replay: true, signatureVerified: input.signatureVerified };
    }

    const payment = await this.payments.recordWebhookOutcome({
      orderId: input.orderId,
      idempotencyKey,
      provider: input.provider,
      providerReference: input.providerReference,
      amount: input.amount,
      outcome: input.outcome,
    });

    return { ok: true, payment, replay: false, signatureVerified: input.signatureVerified };
  }
}
