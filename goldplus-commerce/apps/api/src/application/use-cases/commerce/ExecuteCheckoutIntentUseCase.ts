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
  stageReached,
} from '../../ports/ICheckoutIdempotencyRepository';
import { LeaseLostError, isLeaseLost, requireFence } from './requireFence';
import {
  CheckoutDependencyCode,
  classifyDependencyError,
  isTerminalDependencyCode,
} from '../../ports/CheckoutDependencyOutcomes';
import {
  ICheckoutSideEffectRecorder,
  SideEffectOutcome,
} from '../../ports/ICheckoutSideEffectRecorder';

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
  /** The order is paid and confirmed. NOT merely "the workflow finished". */
  | 'ORDER_CONFIRMED'
  | 'AWAITING_PAYMENT'
  | 'BLOCKED_STOCK'
  | 'CHECKOUT_IN_PROGRESS'
  | 'IDEMPOTENCY_CONFLICT'
  /** The intent already produced an order; this request asks for something else. */
  | 'SUPERSEDED_BY_ORDER'
  /** The intent is spent and produced nothing; a fresh one may proceed at once. */
  | 'INTENT_SPENT'
  | 'PRICE_REVIEW_REQUIRED'
  | 'INTENT_INVALID'
  | 'SESSION_INVALID'
  | 'LEASE_LOST'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';

export interface CheckoutSuccessOutcome {
  kind: 'ORDER_CONFIRMED' | 'AWAITING_PAYMENT' | 'BLOCKED_STOCK';
  /** Where the saga actually got to, independent of whether it stopped running. */
  stage: string;
  order: Order;
  reservationState: OrderReservationState;
  deliveryFeeConfirmed: boolean;
  idempotentReplay: boolean;
  warnings: string[];
}

export interface CheckoutRefusalOutcome {
  kind: Exclude<CheckoutOutcomeKind, 'ORDER_CONFIRMED' | 'AWAITING_PAYMENT' | 'BLOCKED_STOCK'>;
  /** Stable code for the storefront. Never an internal message. */
  reason: string;
  retryAfterSeconds?: number;
  /**
   * The order this intent already produced, on SUPERSEDED_BY_ORDER.
   *
   * Carried so the customer can be told WHICH order they already have and sent
   * to it, instead of being refused with nothing to act on.
   */
  existingOrder?: { orderId: string; orderNumber: string; paymentStatus: string };
}

export type CheckoutOutcome = CheckoutSuccessOutcome | CheckoutRefusalOutcome;

export function isCheckoutSuccess(outcome: CheckoutOutcome): outcome is CheckoutSuccessOutcome {
  return (
    outcome.kind === 'ORDER_CONFIRMED' ||
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
  redeemPoints?: number | null;
  /**
   * The basket this checkout was raised against, and its version.
   *
   * Part of the fingerprint: the item list alone cannot distinguish the basket the
   * customer is looking at from one that has since moved on.
   */
  cartId?: string | null;
  cartVersion?: number | null;
  /** Online versus offline is a materially different operation, not a presentation choice. */
  paymentMethod?: string | null;
  /** R3.1: resolved server-side by the route from the HttpOnly visit token — never from the body. */
  profileId?: string | null;
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
    /** Verified principal from the signed intent — USER links the order to the account. */
    principal: { kind: 'USER' | 'GUEST'; id: string };
    redeemPoints?: number | null;
    paymentMethod?: 'pesapal' | 'offline' | null;
      stitching?: { profileId?: string | null; cartId?: string | null } | null;
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
  /**
   * Durable, idempotent side-effect recording.
   *
   * This replaces the previous in-request `sideEffects` port, which called the
   * fulfilment and notification use cases inline. That work is now queued durably
   * and performed by `ProcessCheckoutSideEffectBatchUseCase`, so a failure is
   * retried instead of disappearing when the response is written.
   */
  sideEffectRecorder: ICheckoutSideEffectRecorder;
  orders: CheckoutOrderCreator;
  reservations: CheckoutReservationRunner;
  orderReader: CheckoutOrderReader;
  /**
   * Key for the fingerprint's personal-data digests.
   *
   * Injected rather than read from the environment here, so the domain stays pure and a
   * test can prove the keyed and unkeyed behaviours without touching process.env.
   */
  fingerprintDigestKey?: string | null;
  observer?: CheckoutObserver;
}



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
      // Where the goods go and how the customer is reached. Omitting these meant a
      // resubmission with a corrected address was answered with the earlier order,
      // bound for the address the customer had just corrected away from.
      deliveryAddress: command.customerDetails.deliveryAddress,
      contactPhone: command.customerDetails.phone,
      contactEmail: command.customerDetails.email ?? null,
      // Personal data is digested under a server-held key. Without one, an unkeyed hash
      // of a phone number is guessable — the input space is small — so the stored
      // digests would allow re-identification of data we deliberately chose not to store.
      digestKey: this.deps.fingerprintDigestKey ?? null,
      // Which basket, at which version, and how they intend to pay.
      cartId: command.cartId ?? null,
      cartVersion: command.cartVersion ?? null,
      paymentMethod: command.paymentMethod ?? null,
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
    // Resume from the STORED SAGA STAGE, not merely from the existence of an
    // order id: the order can exist while the reservation, the fulfilment event
    // and the notification event are each independently done or not done.
    if (claim.record.orderId) {
      const resumed = await this.resume(command, claim.record.orderId, lease, claim.record.stage);
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

      // Classified by the adapter boundary, not by parsing text here. Rewording
      // a message must not silently stop a branch matching, and a database fault
      // whose message happens to start with a business word must not be
      // misclassified as a business rejection.
      const classified = classifyDependencyError(error);
      const code: CheckoutDependencyCode | 'CHECKOUT_ERROR' = classified?.code ?? 'CHECKOUT_ERROR';

      if (code === 'LEASE_LOST') {
        this.deps.observer?.onLeaseLost('ORDER_TRANSACTION', command.traceId);
        return { kind: 'CHECKOUT_IN_PROGRESS', reason: 'LEASE_LOST', retryAfterSeconds: 2 };
      }

      const terminal = code !== 'CHECKOUT_ERROR' && isTerminalDependencyCode(code);
      // Best-effort: if the claim cannot be released it lapses on its own lease.
      await this.deps.idempotency.fail(lease, code, !terminal).catch(() => undefined);

      return terminal
        ? { kind: 'FAILED_FINAL', reason: code }
        : { kind: 'FAILED_RETRYABLE', reason: code };
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
      redeemPoints: command.redeemPoints ?? null,
      paymentMethod: command.paymentMethod === 'pesapal' || command.paymentMethod === 'offline' ? command.paymentMethod : null,
      stitching: { profileId: command.profileId ?? null, cartId: command.cartId ?? null },
      checkoutLink: lease,
      principal: { kind: command.claims.kind, id: command.claims.principalId },
    });

    return this.afterOrder(command, lease, created.order, {
      deliveryFeeConfirmed: created.deliveryFeeConfirmed,
      idempotentReplay: created.idempotentReplay,
    });
  }

  /**
   * Everything after the order exists: reservation, durable side effects, and the
   * terminal transition.
   *
   * `resumeFrom` is the stage already reached, so a retry skips work that is
   * durably done instead of repeating it. Resuming on the mere existence of an
   * order id was not enough: the order can exist while the reservation, the
   * fulfilment event and the notification event are each independently done or
   * not done.
   */
  private async afterOrder(
    command: CheckoutCommand,
    lease: LeaseToken,
    order: Order,
    meta: { deliveryFeeConfirmed: boolean; idempotentReplay: boolean; resumeFrom?: string },
  ): Promise<CheckoutOutcome> {
    const done = new Set(await this.deps.sideEffectRecorder.recordedTypes(command.identity));
    const alreadyBlocked = meta.resumeFrom === 'BLOCKED_STOCK';

    // Reservation is skipped when a previous attempt durably recorded its result.
    // Re-running it would be a second reservation attempt for one order.
    // Compared by saga POSITION rather than by listing stage names: a list has to
    // be extended every time a later stage is added, and the one time it is
    // forgotten a resume silently reserves the same order twice.
    const reservedAlready = stageReached(meta.resumeFrom, 'INVENTORY_RESERVED');

    let reservationState: OrderReservationState;
    let warnings: string[] = [];
    let fullyReserved: boolean;

    if (alreadyBlocked) {
      reservationState = 'UNRESERVED_BLOCKED';
      fullyReserved = false;
    } else if (reservedAlready) {
      reservationState =
        (await this.deps.orderReader.reservationStateOf(order.id)) ?? 'RESERVED';
      fullyReserved = mayProgressToPayment(reservationState);
    } else {
      const reservation = await this.deps.reservations.execute(order);
      reservationState = reservation.state;
      warnings = reservation.warnings;
      fullyReserved = reservation.fullyReserved;
    }

    const mayPay = mayProgressToPayment(reservationState);

    if (!mayPay) {
      requireFence(
        await this.deps.idempotency.advanceStage(lease, 'BLOCKED_STOCK'),
        'ADVANCE_STAGE',
      );
      // The workflow stops RUNNING here, but the order is neither paid nor
      // confirmed, and the stage says so. finishOperation deliberately does not
      // touch the stage.
      requireFence(await this.deps.idempotency.finishOperation(lease, order.id), 'FINISH_OPERATION');
      return {
        kind: 'BLOCKED_STOCK',
        stage: 'BLOCKED_STOCK',
        order,
        reservationState,
        deliveryFeeConfirmed: meta.deliveryFeeConfirmed,
        idempotentReplay: meta.idempotentReplay,
        warnings,
      };
    }

    if (!reservedAlready) {
      requireFence(
        await this.deps.idempotency.advanceStage(lease, 'INVENTORY_RESERVED'),
        'ADVANCE_STAGE',
      );
    }

    // Durable side effects. The checkout may only advance past each one once the
    // record exists — a report to an observer is evidence, not durability, and a
    // crash after the order committed would otherwise lose the work entirely.
    if (mayCreateFulfilment(reservationState)) {
      const fulfilment = await this.recordSideEffect(command, order, 'ORDER_FULFILMENT_REQUIRED', done, {
        warnings,
        hold: !fullyReserved,
      });
      if (fulfilment !== 'ok') return fulfilment.outcome;
      requireFence(
        await this.deps.idempotency.advanceStage(lease, 'FULFILMENT_QUEUED'),
        'ADVANCE_STAGE',
      );

      const notification = await this.recordSideEffect(
        command, order, 'ORDER_ADMIN_NOTIFICATION_REQUIRED', done, { stockConfirmed: fullyReserved },
      );
      if (notification !== 'ok') return notification.outcome;
      requireFence(
        await this.deps.idempotency.advanceStage(lease, 'NOTIFICATION_QUEUED'),
        'ADVANCE_STAGE',
      );
    }

    // PAYMENT_READY, not COMPLETED. An unpaid order is not a completed one, and
    // recording it as such made every unpaid order look finished to
    // reconciliation, support and the retention sweep.
    requireFence(await this.deps.idempotency.advanceStage(lease, 'PAYMENT_READY'), 'ADVANCE_STAGE');
    requireFence(await this.deps.idempotency.finishOperation(lease, order.id), 'FINISH_OPERATION');

    return {
      kind: 'AWAITING_PAYMENT',
      stage: 'PAYMENT_READY',
      order,
      reservationState,
      deliveryFeeConfirmed: meta.deliveryFeeConfirmed,
      idempotentReplay: meta.idempotentReplay,
      warnings,
    };
  }

  /**
   * Records one side effect durably, or explains why the checkout must not
   * advance.
   *
   * ALREADY_RECORDED is a success: a previous attempt wrote it, so the work is
   * owed exactly once and must not be redone.
   */
  private async recordSideEffect(
    command: CheckoutCommand,
    order: Order,
    eventType: Parameters<ICheckoutSideEffectRecorder['record']>[0]['eventType'],
    done: Set<string>,
    payload: Record<string, unknown>,
  ): Promise<'ok' | { outcome: CheckoutOutcome }> {
    if (done.has(eventType)) return 'ok';

    const result: SideEffectOutcome = await this.deps.sideEffectRecorder.record({
      checkoutIdentity: command.identity,
      orderId: order.id,
      eventType,
      policyVersion: CHECKOUT_POLICY_VERSION,
      payload,
      traceId: command.traceId,
    });

    if (result === 'DURABLY_RECORDED' || result === 'ALREADY_RECORDED') return 'ok';

    // The stage is NOT advanced. The checkout is retained for recovery and the
    // failed stage is surfaced, rather than the order proceeding with work that
    // no record says is owed.
    this.deps.observer?.onSideEffectFailed(eventType, command.traceId, result);
    return {
      outcome:
        result === 'RETRYABLE_FAILURE'
          ? { kind: 'FAILED_RETRYABLE', reason: eventType }
          : { kind: 'FAILED_FINAL', reason: eventType },
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
    resumeFrom?: string,
  ): Promise<CheckoutOutcome | null> {
    const order = await this.deps.orderReader.findById(orderId);
    if (!order) return null;
    return this.afterOrder(command, lease, order, {
      deliveryFeeConfirmed: order.deliveryFeeConfirmed,
      idempotentReplay: true,
      resumeFrom,
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
      case 'INTENT_SPENT':
        // Nothing was created under the old intent, so nothing can be
        // duplicated. The caller mints a fresh intent and submits again.
        return { kind: 'INTENT_SPENT', reason: 'INTENT_SPENT' };
      case 'SUPERSEDED_BY_ORDER': {
        // Name the order the customer already has. If it can no longer be
        // loaded there is nothing to point them at and nothing to duplicate,
        // so this degrades to a spent intent rather than a dead end.
        const existing = await this.deps.orderReader.findById(decision.orderId);
        if (!existing) return { kind: 'INTENT_SPENT', reason: 'INTENT_SPENT' };
        return {
          kind: 'SUPERSEDED_BY_ORDER',
          reason: 'INTENT_ALREADY_ORDERED',
          existingOrder: {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            paymentStatus: existing.paymentStatus,
          },
        };
      }
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
          // An order awaiting payment is AWAITING_PAYMENT, never confirmed.
          kind: !mayProgressToPayment(state)
            ? 'BLOCKED_STOCK'
            : order.paymentStatus === 'paid'
              ? 'ORDER_CONFIRMED'
              : 'AWAITING_PAYMENT',
          stage: (record as { stage?: string })?.stage ?? 'COMPLETED',
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

}
