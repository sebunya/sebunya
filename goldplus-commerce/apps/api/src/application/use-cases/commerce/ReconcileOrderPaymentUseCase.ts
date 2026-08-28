import {
  CheckoutSagaStage,
  ICheckoutIdempotencyRepository,
} from '../../ports/ICheckoutIdempotencyRepository';
import { ICheckoutSideEffectRecorder } from '../../ports/ICheckoutSideEffectRecorder';
import { CHECKOUT_POLICY_VERSION } from '../../../domain/commerce/CheckoutPrincipal';

/**
 * Settles a checkout once the provider has told us what happened to the payment.
 *
 * WHY THIS EXISTS
 * The callback and IPN routes each held ~100 lines of the same orchestration: verify,
 * update fulfilment, award loyalty, send an admin email, record a measurement
 * reconciliation. Two copies of a payment settlement path is two places for them to
 * drift, and the drift would be invisible — an order settled by IPN would quietly
 * differ from one settled by the browser callback.
 *
 * It also closes a real gap in the saga. Nothing advanced the stage after
 * PAYMENT_STARTED, so ORDER_CONFIRMED and COMPLETED were vocabulary the system defined
 * and never reached: a fully paid order sat at PAYMENT_STARTED forever, and anything
 * asking "is this checkout finished?" got the same answer as for a customer still
 * staring at the bank page.
 *
 * THE CENTRAL RULE
 * An UNVERIFIED or UNKNOWN payment progresses NOTHING. Not the stage, not fulfilment,
 * not loyalty, not a conversion event, not a payment-success message. "We could not
 * confirm this payment" and "this payment succeeded" are different facts, and the only
 * safe way to treat the first is as not-yet-paid — a customer who did pay can be
 * reconciled later, whereas goods dispatched against a payment that never landed cannot
 * be un-dispatched.
 */

export type PaymentSettlementKind =
  /** Verified paid. The order may be confirmed and downstream work may start. */
  | 'CONFIRMED'
  /** Verified failed, cancelled or reversed. Terminal, and nothing progresses. */
  | 'FAILED'
  /** The provider has not decided yet. Nothing progresses; ask again later. */
  | 'PENDING'
  /** We could not establish what happened. Nothing progresses; a human decides. */
  | 'REVIEW_REQUIRED'
  /** Already settled by an earlier callback. Idempotent no-op. */
  | 'ALREADY_SETTLED'
  /** Nothing here matches a known payment attempt. */
  | 'UNKNOWN_ATTEMPT';

export interface PaymentSettlementOutcome {
  kind: PaymentSettlementKind;
  orderId: string | null;
  /** The saga stage the checkout now holds, when one was recorded. */
  stage: CheckoutSagaStage | null;
  /** Stable code. Never an internal message. */
  reason: string;
}

export function paymentDidConfirm(outcome: PaymentSettlementOutcome): boolean {
  return outcome.kind === 'CONFIRMED';
}

/** What the provider verification concluded, narrowed to what settlement needs. */
export interface PaymentVerificationResult {
  ok: boolean;
  orderId: string;
  /** The adapter's status vocabulary. Mapped here, once. */
  status: string;
  /**
   * The provider's answer was established but the order refused the move.
   * Money may have arrived against an order that cannot receive it, so this is
   * settled by a person rather than confirmed automatically.
   */
  lifecycleConflict?: boolean;
}

export interface ReconcileOrderPaymentDeps {
  idempotency: ICheckoutIdempotencyRepository;
  sideEffectRecorder: ICheckoutSideEffectRecorder;
  observer?: {
    onSettled(orderId: string, kind: PaymentSettlementKind, traceId: string): void;
    onReviewRequired(orderId: string, traceId: string, reason: string): void;
  };
}

/**
 * Provider statuses that mean money actually moved.
 *
 * An allowlist, not a denylist. A status this code has never seen must fall through to
 * REVIEW_REQUIRED rather than being read as success — a provider adding a new status is
 * far more likely than a provider removing one, and the failure mode of guessing wrong
 * is dispatching goods against an unconfirmed payment.
 */
const CONFIRMED_STATUSES = new Set(['completed', 'paid', 'success']);
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'invalid', 'reversed']);
const PENDING_STATUSES = new Set(['pending', 'verification_pending', 'processing']);

/**
 * Stages a settlement may legitimately leave.
 *
 * A checkout that never reached payment cannot be settled by a callback: that would mean
 * a provider event arrived for an order the customer never handed over, which is a
 * reconciliation exception, not a confirmation.
 */
const SETTLEABLE_STAGES: readonly CheckoutSagaStage[] = [
  'PAYMENT_READY',
  'PAYMENT_STARTED',
  'PAYMENT_PENDING',
  'PAYMENT_REVIEW',
];

export class ReconcileOrderPaymentUseCase {
  constructor(private readonly deps: ReconcileOrderPaymentDeps) {}

  async execute(args: {
    verification: PaymentVerificationResult;
    traceId: string;
  }): Promise<PaymentSettlementOutcome> {
    const { verification, traceId } = args;
    const orderId = (verification.orderId || '').trim();

    if (!orderId) {
      return { kind: 'UNKNOWN_ATTEMPT', orderId: null, stage: null, reason: 'NO_ORDER_REFERENCE' };
    }

    const checkout = await this.deps.idempotency.findByOrderId(orderId);
    if (!checkout) {
      // A provider event for an order with no checkout record. Reported rather than
      // acted on: there is nothing to attest that this order was ever handed to payment.
      this.deps.observer?.onReviewRequired(orderId, traceId, 'NO_CHECKOUT_RECORD');
      return { kind: 'UNKNOWN_ATTEMPT', orderId, stage: null, reason: 'NO_CHECKOUT_RECORD' };
    }

    // Already settled. Duplicate callbacks are normal — providers retry, and the browser
    // callback and the IPN routinely both arrive — so this is an expected path, not an
    // error, and it must change nothing.
    if (checkout.stage === 'ORDER_CONFIRMED' || checkout.stage === 'COMPLETED') {
      return {
        kind: 'ALREADY_SETTLED',
        orderId,
        stage: checkout.stage as CheckoutSagaStage,
        reason: 'ALREADY_CONFIRMED',
      };
    }

    const status = (verification.status || '').trim().toLowerCase();

    // Verification itself failing outranks whatever status came with it: if we could not
    // establish the result, the status is not evidence of anything.
    if (!verification.ok) {
      return this.review(orderId, checkout.stage, traceId, 'VERIFICATION_FAILED');
    }

    // The provider answered, but the order's own state machine refused the move.
    // Confirming here would mark fulfilment paid, settle loyalty and tell the
    // customer "payment received" for an order that could not accept the payment.
    if (verification.lifecycleConflict) {
      return this.review(orderId, checkout.stage, traceId, 'LIFECYCLE_CONFLICT');
    }

    if (FAILED_STATUSES.has(status)) {
      // Terminal, and deliberately NOT advanced to a confirmed stage. The order remains
      // unpaid and the customer may retry onto the same checkout.
      this.deps.observer?.onSettled(orderId, 'FAILED', traceId);
      return { kind: 'FAILED', orderId, stage: checkout.stage as CheckoutSagaStage, reason: 'PAYMENT_FAILED' };
    }

    if (PENDING_STATUSES.has(status)) {
      // Recorded so an operator can see the payment is genuinely in flight rather than
      // abandoned, but nothing downstream starts.
      const applied = await this.deps.idempotency
        .advancePaymentStage(orderId, 'PAYMENT_PENDING', ['PAYMENT_READY', 'PAYMENT_STARTED'])
        .catch(() => false);
      this.deps.observer?.onSettled(orderId, 'PENDING', traceId);
      return {
        kind: 'PENDING',
        orderId,
        stage: applied ? 'PAYMENT_PENDING' : (checkout.stage as CheckoutSagaStage),
        reason: 'PAYMENT_PENDING',
      };
    }

    if (!CONFIRMED_STATUSES.has(status)) {
      // An unrecognised status. Never optimistically treated as success.
      return this.review(orderId, checkout.stage, traceId, 'UNRECOGNISED_PAYMENT_STATUS');
    }

    // Confirmed. Only now may the saga advance and downstream work be owed.
    const advanced = await this.deps.idempotency.advancePaymentStage(
      orderId,
      'ORDER_CONFIRMED',
      SETTLEABLE_STAGES,
    );

    if (!advanced) {
      // The stage was not one a settlement may leave — a callback for a checkout that
      // never reached payment, or one another process settled between the read and here.
      // Either way this process must not claim the settlement.
      this.deps.observer?.onReviewRequired(orderId, traceId, 'STAGE_NOT_SETTLEABLE');
      return {
        kind: 'REVIEW_REQUIRED',
        orderId,
        stage: checkout.stage as CheckoutSagaStage,
        reason: 'STAGE_NOT_SETTLEABLE',
      };
    }

    // Durable, and idempotent by (checkout identity, event type), so the duplicate
    // callback that arrives thirty seconds later creates nothing. These are RECORDED,
    // not performed: a confirmation must not depend on an email provider being reachable.
    for (const eventType of [
      'ORDER_CUSTOMER_NOTIFICATION_ELIGIBLE',
      'ORDER_LOYALTY_ELIGIBILITY_RECORDED',
      'ORDER_MEASUREMENT_ELIGIBILITY_RECORDED',
    ] as const) {
      await this.deps.sideEffectRecorder
        .record({
          checkoutIdentity: checkout.identity,
          orderId,
          eventType,
          policyVersion: CHECKOUT_POLICY_VERSION,
          payload: { orderId },
          traceId,
        })
        .catch(() => 'RETRYABLE_FAILURE' as const);
    }

    this.deps.observer?.onSettled(orderId, 'CONFIRMED', traceId);
    return { kind: 'CONFIRMED', orderId, stage: 'ORDER_CONFIRMED', reason: 'PAYMENT_CONFIRMED' };
  }

  /**
   * Parks the checkout for a human.
   *
   * PAYMENT_REVIEW is a real stage, not a log line: it keeps the checkout out of the
   * retention sweep and makes the unresolved payment findable, which "we logged a
   * warning" does not.
   */
  private async review(
    orderId: string,
    currentStage: string,
    traceId: string,
    reason: string,
  ): Promise<PaymentSettlementOutcome> {
    const applied = await this.deps.idempotency
      .advancePaymentStage(orderId, 'PAYMENT_REVIEW', ['PAYMENT_READY', 'PAYMENT_STARTED', 'PAYMENT_PENDING'])
      .catch(() => false);
    this.deps.observer?.onReviewRequired(orderId, traceId, reason);
    return {
      kind: 'REVIEW_REQUIRED',
      orderId,
      stage: applied ? 'PAYMENT_REVIEW' : (currentStage as CheckoutSagaStage),
      reason,
    };
  }
}
