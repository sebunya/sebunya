import {
  CHECKOUT_POLICY_VERSION,
  checkoutFingerprint,
  decideIdempotency,
} from '../../../domain/commerce/CheckoutPrincipal';
import {
  OrderReservationState,
  mayCreateFulfilment,
  mayProgressToPayment,
} from '../../../domain/inventory/Inventory';
import { Order } from '../../../domain/commerce/Order';
import {
  ICheckoutIdempotencyRepository,
  LeaseToken,
} from '../../ports/ICheckoutIdempotencyRepository';
import { LeaseLostError, isLeaseLost, requireFence } from './requireFence';

/**
 * Owns the checkout workflow.
 *
 * The HTTP route previously held 289 lines of orchestration: fingerprinting,
 * claiming, fencing, pricing, order creation, reservation, fulfilment,
 * notification, completion and failure classification. That put transaction and
 * recovery policy in a transport adapter, where it could not be tested without
 * HTTP and could not be reused by any other caller — and where every new branch
 * had to re-derive which side effects had already happened.
 *
 * This use case depends only on ports. It returns typed outcomes rather than
 * throwing for expected commerce decisions, because a stock shortage and a
 * dropped connection are different facts and `catch (err)` cannot tell them
 * apart. The route's only remaining job is to map an outcome to a status code.
 */

export type CheckoutOutcomeKind =
  | 'CHECKOUT_COMPLETED'
  | 'AWAITING_PAYMENT'
  | 'BLOCKED_STOCK'
  | 'CHECKOUT_IN_PROGRESS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PRICE_REVIEW_REQUIRED'
  | 'INTENT_INVALID'
  | 'SESSION_INVALID'
  | 'LEASE_LOST'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';

export interface CheckoutSuccessOutcome {
  kind: 'CHECKOUT_COMPLETED' | 'AWAITING_PAYMENT' | 'BLOCKED_STOCK';
  order: Order;
  reservationState: OrderReservationState;
  deliveryFeeConfirmed: boolean;
  idempotentReplay: boolean;
  warnings: string[];
}

export interface CheckoutRefusalOutcome {
  kind: Exclude<CheckoutOutcomeKind, 'CHECKOUT_COMPLETED' | 'AWAITING_PAYMENT' | 'BLOCKED_STOCK'>;
  /** Stable code for the storefront. Never an internal message. */
  reason: string;
  retryAfterSeconds?: number;
}

export type CheckoutOutcome = CheckoutSuccessOutcome | CheckoutRefusalOutcome;

export function isCheckoutSuccess(outcome: CheckoutOutcome): outcome is CheckoutSuccessOutcome {
  return (
    outcome.kind === 'CHECKOUT_COMPLETED' ||
    outcome.kind === 'AWAITING_PAYMENT' ||
    outcome.kind === 'BLOCKED_STOCK'
  );
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface CheckoutIntentClaimsLike {
  intentId: string;
  kind: 'USER' | 'GUEST';
  principalId: string;
}

export interface CheckoutCommand {
  claims: CheckoutIntentClaimsLike;
  identity: string;
  principalKey: string;
  customerDetails: {
    name: string;
    email?: string;
    phone: string;
    deliveryArea: string;
    deliveryAddress: string;
    deliveryLocation?: { district: string } | null;
  };
  buyerType: 'retail' | 'wholesale' | 'corporate';
  items: Array<{ productId: string; quantity: number }>;
  couponCode?: string | null;
  previewQuoteId?: string | null;
  acceptPriceChange?: boolean;
  traceId: string;
}

export interface CheckoutOrderCreator {
  execute(input: {
    customerDetails: CheckoutCommand['customerDetails'];
    buyerType: string;
    items: CheckoutCommand['items'];
    clientOrderKey: string | null;
    couponCode: string | null;
    previewQuoteId: string | null;
    acceptPriceChange: boolean;
    checkoutLink?: LeaseToken;
  }): Promise<{ order: Order; deliveryFeeConfirmed: boolean; idempotentReplay: boolean }>;
}

export interface CheckoutReservationRunner {
  execute(order: Order): Promise<{
    state: OrderReservationState;
    code: string;
    fullyReserved: boolean;
    warnings: string[];
  }>;
}

export interface CheckoutSideEffects {
  /** Durable, idempotent by order id. Failure is reported, never swallowed. */
  queueFulfilment(order: Order, opts: { warnings: string[]; hold: boolean }): Promise<void>;
  queueAdminNotification(order: Order, opts: { stockConfirmed: boolean }): Promise<void>;
}

export interface CheckoutOrderReader {
  findById(orderId: string): Promise<Order | null>;
  reservationStateOf(orderId: string): Promise<OrderReservationState | null>;
}

export interface CheckoutObserver {
  onLeaseLost(stage: string, traceId: string): void;
  onSideEffectFailed(stage: string, traceId: string, message: string): void;
}

export interface ExecuteCheckoutIntentDeps {
  idempotency: ICheckoutIdempotencyRepository;
  orders: CheckoutOrderCreator;
  reservations: CheckoutReservationRunner;
  sideEffects: CheckoutSideEffects;
  orderReader: CheckoutOrderReader;
  observer?: CheckoutObserver;
}

/** Business rejections that must not be retried into the same failure forever. */
const TERMINAL_REASONS = [
  'PRODUCT_UNAVAILABLE',
  'PRICE_UNAVAILABLE',
  'PRICE_CHANGED',
  'PROMOTION_CHANGED',
];

export class ExecuteCheckoutIntentUseCase {
  constructor(private readonly deps: ExecuteCheckoutIntentDeps) {}

  async execute(command: CheckoutCommand): Promise<CheckoutOutcome> {
    const fingerprint = checkoutFingerprint({
      principal: { kind: command.claims.kind, id: command.claims.principalId },
      items: command.items,
      buyerType: command.buyerType,
      couponCode: command.couponCode ?? null,
      deliveryZoneKey:
        command.customerDetails.deliveryLocation?.district ?? command.customerDetails.deliveryArea,
      currency: 'UGX',
      acceptedQuoteId: command.previewQuoteId ?? null,
      policyVersion: CHECKOUT_POLICY_VERSION,
    });

    const claim = await this.deps.idempotency.claim({
      identity: command.identity,
      principalKey: command.principalKey,
      fingerprint,
    });

    // Somebody else owns this operation, or it already finished.
    if (!claim.claimed) {
      return this.resolveExisting(command, claim.record, fingerprint);
    }

    // A claim reported as acquired without a lease is incoherent: there would be
    // no way to prove ownership of work about to begin. Fail closed.
    if (!claim.lease) {
      return { kind: 'LEASE_LOST', reason: 'CLAIM_WITHOUT_LEASE' };
    }
    const lease = claim.lease;

    // A takeover resumes from durable evidence rather than restarting. Without
    // this, a retry after a partial success would re-price, re-create and
    // re-reserve work that already committed.
    if (claim.record.orderId) {
      const resumed = await this.resume(command, claim.record.orderId, lease);
      if (resumed) return resumed;
    }

    try {
      return await this.run(command, lease, fingerprint);
    } catch (error) {
      if (isLeaseLost(error)) {
        this.deps.observer?.onLeaseLost((error as LeaseLostError).stage, command.traceId);
        // Deliberately NOT marked failed: that would overwrite the successor
        // this fence exists to protect.
        return { kind: 'CHECKOUT_IN_PROGRESS', reason: 'LEASE_LOST', retryAfterSeconds: 2 };
      }

      const message = error instanceof Error ? error.message : String(error);
      const terminal = TERMINAL_REASONS.find((r) => message.startsWith(r));
      // Best-effort: if the claim cannot be released it lapses on its own lease.
      await this.deps.idempotency
        .fail(lease, terminal ?? 'CHECKOUT_ERROR', !terminal)
        .catch(() => undefined);

      return terminal
        ? { kind: 'FAILED_FINAL', reason: terminal }
        : { kind: 'FAILED_RETRYABLE', reason: 'CHECKOUT_ERROR' };
    }
  }

  /** The forward path, from a fresh or taken-over claim. */
  private async run(
    command: CheckoutCommand,
    lease: LeaseToken,
    _fingerprint: string,
  ): Promise<CheckoutOutcome> {
    // Order creation and the fenced claim link commit together. Two statements
    // left a window where a crash produced a committed order with no
    // recoverable checkout identity.
    const created = await this.deps.orders.execute({
      customerDetails: command.customerDetails,
      buyerType: command.buyerType,
      items: command.items,
      clientOrderKey: null,
      couponCode: command.couponCode ?? null,
      previewQuoteId: command.previewQuoteId ?? null,
      acceptPriceChange: command.acceptPriceChange ?? false,
      checkoutLink: lease,
    });

    return this.afterOrder(command, lease, created.order, {
      deliveryFeeConfirmed: created.deliveryFeeConfirmed,
      idempotentReplay: created.idempotentReplay,
    });
  }

  /** Everything after the order exists: reservation, side effects, completion. */
  private async afterOrder(
    command: CheckoutCommand,
    lease: LeaseToken,
    order: Order,
    meta: { deliveryFeeConfirmed: boolean; idempotentReplay: boolean },
  ): Promise<CheckoutOutcome> {
    const reservation = await this.deps.reservations.execute(order);

    // One canonical decision. An inverted `stockHeld = !fullyReserved` forced
    // every downstream branch to be re-derived by negation.
    const decision = {
      reservationState: reservation.state,
      stockConfirmed: reservation.fullyReserved,
      requiresHold: !reservation.fullyReserved,
      mayPay: mayProgressToPayment(reservation.state),
      mayFulfil: mayCreateFulfilment(reservation.state),
    };

    if (!decision.mayPay) {
      requireFence(
        await this.deps.idempotency.advanceStage(lease, 'BLOCKED_STOCK'),
        'ADVANCE_STAGE',
      );
      requireFence(await this.deps.idempotency.complete(lease, order.id), 'COMPLETE');
      return {
        kind: 'BLOCKED_STOCK',
        order,
        reservationState: decision.reservationState,
        deliveryFeeConfirmed: meta.deliveryFeeConfirmed,
        idempotentReplay: meta.idempotentReplay,
        warnings: reservation.warnings,
      };
    }

    requireFence(
      await this.deps.idempotency.advanceStage(lease, 'INVENTORY_RESERVED'),
      'ADVANCE_STAGE',
    );

    if (decision.mayFulfil) {
      // Reported, not swallowed. A console.error here left the operator with a
      // paid order and no work item, and nothing to alert on.
      await this.durably('FULFILMENT_QUEUED', command.traceId, () =>
        this.deps.sideEffects.queueFulfilment(order, {
          warnings: reservation.warnings,
          hold: decision.requiresHold,
        }),
      );
      await this.durably('NOTIFICATION_QUEUED', command.traceId, () =>
        this.deps.sideEffects.queueAdminNotification(order, {
          stockConfirmed: decision.stockConfirmed,
        }),
      );
    }

    requireFence(
      await this.deps.idempotency.advanceStage(lease, 'AWAITING_PAYMENT'),
      'ADVANCE_STAGE',
    );
    requireFence(await this.deps.idempotency.complete(lease, order.id), 'COMPLETE');

    return {
      kind: 'AWAITING_PAYMENT',
      order,
      reservationState: decision.reservationState,
      deliveryFeeConfirmed: meta.deliveryFeeConfirmed,
      idempotentReplay: meta.idempotentReplay,
      warnings: reservation.warnings,
    };
  }

  /**
   * Resumes from a durable order rather than creating another.
   *
   * Returns null when the recorded order can no longer be loaded, so the caller
   * falls through to the forward path instead of resuming from a phantom.
   */
  private async resume(
    command: CheckoutCommand,
    orderId: string,
    lease: LeaseToken,
  ): Promise<CheckoutOutcome | null> {
    const order = await this.deps.orderReader.findById(orderId);
    if (!order) return null;
    return this.afterOrder(command, lease, order, {
      deliveryFeeConfirmed: order.deliveryFeeConfirmed,
      idempotentReplay: true,
    });
  }

  /** Maps an existing record to an outcome without doing any commerce work. */
  private async resolveExisting(
    command: CheckoutCommand,
    record: Parameters<typeof decideIdempotency>[0],
    fingerprint: string,
  ): Promise<CheckoutOutcome> {
    const decision = decideIdempotency(record, fingerprint);

    switch (decision.action) {
      case 'CONFLICT':
        return { kind: 'IDEMPOTENCY_CONFLICT', reason: decision.reason };
      case 'IN_FLIGHT':
        return {
          kind: 'CHECKOUT_IN_PROGRESS',
          reason: 'ALREADY_PROCESSING',
          retryAfterSeconds: decision.retryAfterSeconds,
        };
      case 'TERMINAL':
        return { kind: 'FAILED_FINAL', reason: decision.reason };
      case 'RETURN_EXISTING': {
        const order = await this.deps.orderReader.findById(decision.orderId);
        if (!order) {
          // The record names an order that cannot be loaded. Refusing is safer
          // than inventing a replay.
          return { kind: 'FAILED_FINAL', reason: 'ORDER_NOT_LOADABLE' };
        }
        const state =
          (await this.deps.orderReader.reservationStateOf(decision.orderId)) ?? 'PENDING';
        return {
          kind: mayProgressToPayment(state) ? 'CHECKOUT_COMPLETED' : 'BLOCKED_STOCK',
          order,
          reservationState: state,
          deliveryFeeConfirmed: order.deliveryFeeConfirmed,
          idempotentReplay: true,
          warnings: [],
        };
      }
      case 'PROCEED':
      case 'RETRY_ALLOWED':
        // The row vanished or became retryable between the claim and this read.
        // Report in-progress rather than racing a second claim from here.
        return { kind: 'CHECKOUT_IN_PROGRESS', reason: 'RECLAIM_REQUIRED', retryAfterSeconds: 1 };
    }
  }

  /**
   * Runs a side effect, reporting failure instead of swallowing it.
   *
   * The failure does NOT abort the checkout: the order is already committed and
   * discarding it would be worse. But it must be visible — a console.error left
   * the operator with an order and no work item and nothing to alert on.
   */
  private async durably(stage: string, traceId: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.deps.observer?.onSideEffectFailed(
        stage,
        traceId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
