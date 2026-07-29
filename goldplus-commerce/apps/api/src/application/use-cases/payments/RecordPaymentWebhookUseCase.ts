import { IPaymentRepository, PaymentWebhookOutcome, RecordedPayment } from '../../ports/IPaymentRepository';
import { decideWebhookVerification } from '../../../domain/payments/WebhookVerificationPolicy';

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
  /** Whether a signing secret exists for this provider at all. */
  secretConfigured?: boolean;
  /** Monitored grace mode for an unconfigured provider. Default off. */
  graceEnabled?: boolean;
}

export type RecordPaymentWebhookResult =
  | {
      ok: true;
      payment: RecordedPayment;
      replay: boolean;
      signatureVerified: boolean;
      /** True when grace mode recorded an unauthenticated payment. */
      requiresReview: boolean;
    }
  | {
      ok: false;
      code:
        | 'UNKNOWN_PROVIDER'
        | 'BAD_AMOUNT'
        | 'BAD_OUTCOME'
        | 'MISSING_IDEMPOTENCY'
        | 'MISSING_ORDER'
        | 'ORDER_NOT_FOUND'
        | 'AMOUNT_MISMATCH'
        | 'SIGNATURE_INVALID';
      message: string;
      /** Present on AMOUNT_MISMATCH so an operator can triage without re-querying. */
      detail?: { expectedAmount: number; reportedAmount: number; orderId: string };
    };

/**
 * Resolves the authoritative amount an order should be paid. Optional so existing
 * callers keep working unchanged; when supplied, the webhook is verified against it.
 */
export interface OrderAmountResolver {
  findTotalAmount(orderId: string): Promise<number | null>;
}

export class RecordPaymentWebhookUseCase {
  constructor(
    private readonly payments: IPaymentRepository,
    private readonly orders?: OrderAmountResolver,
  ) {}

  public async execute(input: RecordPaymentWebhookInput): Promise<RecordPaymentWebhookResult> {
    if (!ALLOWED_PROVIDERS.has(input.provider as PaymentProvider)) {
      return { ok: false, code: 'UNKNOWN_PROVIDER', message: `Provider "${input.provider}" is not enabled.` };
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      return { ok: false, code: 'BAD_AMOUNT', message: 'Amount must be a positive integer (UGX, no decimals).' };
    }
    // An unverified webhook is not recorded. At all.
    //
    // signatureVerified used to be threaded through this whole use case and
    // returned in the result without ever gating anything: an unsigned request,
    // a wrongly-signed request, and a request arriving while the provider secret
    // was simply unset were all recorded as genuine payments. Anyone who could
    // reach the endpoint could POST {orderId, amount, outcome: "SUCCESS"} and
    // mark an order paid, with no credential of any kind.
    //
    // This check is FIRST. Nothing about an unauthenticated payload — not the
    // order id, not the amount, not the idempotency key — deserves to be acted
    // on, and every later branch here reads or writes on its behalf.
    const verification = decideWebhookVerification({
      signatureVerified: input.signatureVerified,
      secretConfigured: input.secretConfigured ?? input.signatureVerified,
      graceEnabled: input.graceEnabled ?? false,
    });

    if (verification.action === 'REJECT') {
      return {
        ok: false,
        code: 'SIGNATURE_INVALID',
        // Deliberately uninformative: distinguishing "wrong signature" from
        // "no secret configured" tells an attacker which one to work on.
        message: 'Webhook signature could not be verified. The payment was not recorded.',
      };
    }

    const requiresReview = verification.action === 'ACCEPT_UNVERIFIED';

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

    // Verify the provider-reported amount against the order total BEFORE recording.
    //
    // The provider payload is untrusted input: a signature proves who sent it, not
    // that the figure is right. Without this check a SUCCESS webhook reporting less
    // than the order total marks the order paid for the smaller sum — the customer
    // is under-charged and nothing downstream ever notices, because the recorded
    // payment becomes the only record of what "should" have been paid.
    //
    // A mismatch is never auto-accepted and never auto-rejected: it is surfaced for
    // manual review, because both an under-payment and an over-payment can be
    // legitimate (partial settlement, provider fees) and guessing either way is a
    // financial decision this code is not entitled to make.
    if (this.orders) {
      const expectedAmount = await this.orders.findTotalAmount(input.orderId);
      if (expectedAmount === null) {
        return {
          ok: false,
          code: 'ORDER_NOT_FOUND',
          message: `Order "${input.orderId}" does not exist; refusing to record a payment against it.`,
        };
      }
      if (input.outcome === 'SUCCESS' && input.amount !== expectedAmount) {
        return {
          ok: false,
          code: 'AMOUNT_MISMATCH',
          message:
            `Provider reported ${input.amount} for order ${input.orderId} but the order total is ` +
            `${expectedAmount}. The payment was NOT recorded and requires manual review.`,
          detail: { expectedAmount, reportedAmount: input.amount, orderId: input.orderId },
        };
      }
    }

    const existing = await this.payments.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        ok: true,
        payment: existing,
        replay: true,
        signatureVerified: input.signatureVerified,
        requiresReview,
      };
    }

    const payment = await this.payments.recordWebhookOutcome({
      orderId: input.orderId,
      idempotencyKey,
      provider: input.provider,
      providerReference: input.providerReference,
      amount: input.amount,
      outcome: input.outcome,
      signatureVerified: input.signatureVerified,
      requiresReview,
    });

    return { ok: true, payment, replay: false, signatureVerified: input.signatureVerified, requiresReview };
  }
}
