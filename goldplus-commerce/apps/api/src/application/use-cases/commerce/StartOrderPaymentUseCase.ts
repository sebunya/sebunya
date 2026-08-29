import {
  ICheckoutIdempotencyRepository,
  stageReached,
} from '../../ports/ICheckoutIdempotencyRepository';
import { ICheckoutSideEffectRecorder } from '../../ports/ICheckoutSideEffectRecorder';
import { CHECKOUT_POLICY_VERSION } from '../../../domain/commerce/CheckoutPrincipal';

/**
 * Starts payment for an order the caller is entitled to pay for.
 *
 * THREE DEFECTS THIS CLOSES
 *
 * 1. No authorization at all. The endpoint took an orderId from the request body
 *    and started a provider transaction against it. Any caller who knew or
 *    guessed an order id could open a PesaPal transaction for somebody else's
 *    order and be handed its redirect URL. Ownership is now checked against the
 *    server's own record of which principal's checkout produced the order.
 *
 * 2. The provider was called again on every retry. An attempt already `pending`
 *    with a redirect URL still submitted a second order request for the same
 *    merchant reference, so one order could accumulate several live provider
 *    transactions. A usable existing attempt is now reused.
 *
 * 3. Every outcome was an untyped 400 carrying the internal message. A missing
 *    IPN configuration — a server fault — was reported to the customer as a bad
 *    request, with the server's own error text in the body. Outcomes are typed and
 *    the route maps them; no internal text crosses the boundary.
 *
 * The saga stage is advanced so payment progress is durable. Without it, an order
 * sat at PAYMENT_READY forever and nothing could distinguish "the customer never
 * tried to pay" from "the customer is at the bank page right now".
 */

export type StartPaymentOutcomeKind =
  | 'REDIRECT_READY'
  /** A live provider transaction already exists; the same URL is returned. */
  | 'ALREADY_STARTED'
  | 'ALREADY_PAID'
  | 'NOT_PAYABLE'
  /**
   * Also returned when the order exists but belongs to another principal. There is
   * deliberately no FORBIDDEN: distinguishing "not yours" from "no such order"
   * turns the endpoint into an order-id oracle.
   */
  | 'NOT_FOUND'
  | 'OFFLINE_DRAFT'
  /** The server is not configured to take payments. Not the caller's fault. */
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE';

export type StartPaymentOutcome =
  | {
      kind: 'REDIRECT_READY' | 'ALREADY_STARTED';
      redirectUrl: string;
      orderTrackingId: string;
      merchantReference: string;
    }
  | {
      kind: Exclude<StartPaymentOutcomeKind, 'REDIRECT_READY' | 'ALREADY_STARTED'>;
      reason: string;
    };

export function isRedirectReady(
  outcome: StartPaymentOutcome,
): outcome is Extract<StartPaymentOutcome, { redirectUrl: string }> {
  return outcome.kind === 'REDIRECT_READY' || outcome.kind === 'ALREADY_STARTED';
}

export interface StartPaymentCommand {
  orderId: string;
  /**
   * The principal key of the caller, derived server-side from a verified checkout
   * intent or session. Never a value from the request body — that is the hole this
   * closes.
   */
  principalKey: string;
  traceId: string;
}

/** The provider call, narrowed to what this use case needs. */
export interface PaymentProviderStarter {
  execute(input: { orderId: string }): Promise<{
    redirectUrl: string;
    orderTrackingId: string;
    merchantReference: string;
  }>;
}

export interface PaymentAttemptReader {
  findAttemptsByOrderId(orderId: string): Promise<
    Array<{ status: string; redirectUrl: string | null; orderTrackingId: string | null; merchantReference: string; amount: number }>
  >;
}

export interface StartPaymentOrderReader {
  findById(orderId: string): Promise<{ id: string; paymentStatus: string; totalUgx: number } | null>;
}

export interface StartOrderPaymentDeps {
  idempotency: ICheckoutIdempotencyRepository;
  orders: StartPaymentOrderReader;
  attempts: PaymentAttemptReader;
  provider: PaymentProviderStarter;
  sideEffectRecorder: ICheckoutSideEffectRecorder;
  observer?: {
    onForbidden(orderId: string, traceId: string): void;
    onNotPayable(orderId: string, traceId: string, stage: string): void;
    onProviderFailure(orderId: string, traceId: string, code: string): void;
  };
}

/**
 * Attempt statuses that mean a live provider transaction exists and its redirect
 * URL is still the right place to send the customer. `failed`, `cancelled`,
 * `invalid` and `reversed` are deliberately absent: those need a fresh attempt.
 */
const REUSABLE_ATTEMPT_STATUSES = new Set(['pending', 'verification_pending']);

/**
 * Provider faults that will not resolve by retrying the same request. Kept as a
 * code list rather than message matching, so rewording an adapter's error cannot
 * silently change how the customer is treated.
 */
const CONFIG_CODES = new Set(['PESAPAL_CONFIG_MISSING', 'PESAPAL_NOT_CONFIGURED']);

function providerErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]{3,63}):/.exec(message);
  return match ? match[1] : 'PROVIDER_ERROR';
}

export class StartOrderPaymentUseCase {
  constructor(private readonly deps: StartOrderPaymentDeps) {}

  async execute(command: StartPaymentCommand): Promise<StartPaymentOutcome> {
    const orderId = command.orderId.trim();
    if (!orderId) return { kind: 'NOT_FOUND', reason: 'ORDER_ID_REQUIRED' };

    // An offline draft exists only on the customer's device. Refused before any
    // lookup: there is nothing on the server to authorize against.
    if (orderId.toUpperCase().startsWith('GP-DRAFT-')) {
      return { kind: 'OFFLINE_DRAFT', reason: 'OFFLINE_DRAFT_NOT_PAYABLE' };
    }

    const checkout = await this.deps.idempotency.findByOrderId(orderId);

    // No checkout record means nothing can attest who owns this order. Reported as
    // NOT_FOUND rather than FORBIDDEN so the response does not distinguish "this
    // order exists but is not yours" from "no such order" — that difference is an
    // order-id oracle.
    if (!checkout) return { kind: 'NOT_FOUND', reason: 'ORDER_NOT_FOUND' };

    if (checkout.principalKey !== command.principalKey) {
      this.deps.observer?.onForbidden(orderId, command.traceId);
      return { kind: 'NOT_FOUND', reason: 'ORDER_NOT_FOUND' };
    }

    const order = await this.deps.orders.findById(orderId);
    if (!order) return { kind: 'NOT_FOUND', reason: 'ORDER_NOT_FOUND' };

    if (order.paymentStatus === 'paid') {
      return { kind: 'ALREADY_PAID', reason: 'ORDER_ALREADY_PAID' };
    }

    // The saga must have reached the point where the order is payable. Starting
    // payment for a stock-blocked order would take money for goods nobody
    // established were available.
    if (!stageReached(checkout.stage, 'PAYMENT_READY')) {
      // The stage itself is not returned: the reason code is a stable contract for
      // the storefront, and the diagnostic detail belongs in the log line.
      this.deps.observer?.onNotPayable(orderId, command.traceId, checkout.stage);
      return { kind: 'NOT_PAYABLE', reason: 'ORDER_NOT_PAYABLE' };
    }

    // A live attempt is reused rather than re-submitted. Submitting again gave one
    // order several concurrent provider transactions, any of which could later
    // report a payment.
    const existing = await this.deps.attempts.findAttemptsByOrderId(orderId);
    // ...and only while it is still for the right money. A delivery variance
    // agreed after the attempt was opened raises the order total, but the
    // provider page still quotes the old figure, and verification compares the
    // payment against the ATTEMPT's amount, so the order settled as fully paid
    // at the stale, lower total and the shop silently under-collected.
    const reusable = existing.find(
      (a) =>
        REUSABLE_ATTEMPT_STATUSES.has(a.status) &&
        a.redirectUrl &&
        a.orderTrackingId &&
        a.amount === order.totalUgx,
    );
    if (reusable) {
      await this.recordPaymentProgress(checkout.identity, orderId, command);
      return {
        kind: 'ALREADY_STARTED',
        redirectUrl: reusable.redirectUrl as string,
        orderTrackingId: reusable.orderTrackingId as string,
        merchantReference: reusable.merchantReference,
      };
    }

    let started: { redirectUrl: string; orderTrackingId: string; merchantReference: string };
    try {
      started = await this.deps.provider.execute({ orderId });
    } catch (error) {
      const code = providerErrorCode(error);
      this.deps.observer?.onProviderFailure(orderId, command.traceId, code);
      if (CONFIG_CODES.has(code)) {
        // A server misconfiguration is not a bad request, and the customer must
        // not be shown the server's own error text.
        return { kind: 'PROVIDER_NOT_CONFIGURED', reason: code };
      }
      return { kind: 'PROVIDER_UNAVAILABLE', reason: code };
    }

    await this.recordPaymentProgress(checkout.identity, orderId, command);

    return {
      kind: 'REDIRECT_READY',
      redirectUrl: started.redirectUrl,
      orderTrackingId: started.orderTrackingId,
      merchantReference: started.merchantReference,
    };
  }

  /**
   * Records that payment is under way, and that verification is owed.
   *
   * Both are best-effort with respect to the customer's redirect: the provider
   * transaction already exists, and refusing to send the customer to pay because a
   * bookkeeping write failed would be a worse outcome than a stage that lags. The
   * verification event is the safety net — reconciliation must happen even if the
   * customer closes the tab and never returns, which is exactly the case the
   * callback-only design could not cover.
   */
  private async recordPaymentProgress(
    checkoutIdentity: string,
    orderId: string,
    command: StartPaymentCommand,
  ): Promise<void> {
    await this.deps.idempotency
      .advancePaymentStage(orderId, 'PAYMENT_STARTED', ['PAYMENT_READY'])
      .catch(() => false);

    await this.deps.sideEffectRecorder
      .record({
        // The CHECKOUT identity, not the principal key: the durable identity is
        // unique on (checkout identity, event type), so keying by principal would
        // make one customer's second order suppress its own verification event.
        checkoutIdentity,
        orderId,
        eventType: 'ORDER_PAYMENT_VERIFICATION_REQUIRED',
        policyVersion: CHECKOUT_POLICY_VERSION,
        payload: { orderId },
        traceId: command.traceId,
      })
      .catch(() => 'RETRYABLE_FAILURE' as const);
  }
}
