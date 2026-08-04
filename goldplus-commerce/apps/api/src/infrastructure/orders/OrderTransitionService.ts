import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { orders, orderEvents } from '../db/schema';
import { canTransitionOrder } from '../../domain/commerce/OrderStateMachine';
import { OrderStatus, PaymentStatus } from '../../domain/commerce/Order';
import { DomainError } from '../../domain/errors/DomainError';
import {
  IOrderTransitionPort,
  OrderTransitionContext,
  OrderTransitionResult,
  OrderEventRecord,
} from '../../application/ports/IOrderTransitionPort';

/**
 * The ONE canonical order-status transition path (P0-2). Every application
 * writer routes through here. In a single transaction it locks the order,
 * validates via the canonical OrderStateMachine, updates the status (and, when a
 * verified payment result is supplied, the payment status) and inserts EXACTLY
 * ONE append-only order_event. There is no update/delete on the ledger.
 *
 * Atomicity: a failure at either write rolls back both. Concurrency: the row
 * lock serialises competing transitions, and re-validation against the freshly
 * locked state means a second identical attempt is a no-op (same-status
 * transition is illegal), so a committed transition always has exactly one
 * event. Retries with a stable idempotencyKey return the existing event.
 */
/** The drizzle transaction handle, so infra callers can enlist a transition in
 * an in-flight transaction (e.g. the payment webhook that must commit payment +
 * status + event + outbox together). Kept out of the application port. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OrderTransitionSubscriber = (event: {
  orderId: string;
  toStatus: OrderStatus;
  ctx: OrderTransitionContext;
}) => Promise<void>;

export class OrderTransitionService implements IOrderTransitionPort {
  /**
   * Post-commit subscribers (loyalty vesting, redemption consumption, …).
   * Fired AFTER the transition transaction commits — a subscriber failure can
   * never roll back a real state change, and each subscriber is isolated.
   */
  private readonly subscribers: OrderTransitionSubscriber[] = [];

  onTransition(subscriber: OrderTransitionSubscriber): void {
    this.subscribers.push(subscriber);
  }

  private async notify(orderId: string, toStatus: OrderStatus, ctx: OrderTransitionContext): Promise<void> {
    for (const subscriber of this.subscribers) {
      try {
        await subscriber({ orderId, toStatus, ctx });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('order transition subscriber failed', { orderId, toStatus, error: (error as Error).message });
      }
    }
  }

  async transition(
    orderId: string,
    toStatus: OrderStatus,
    ctx: OrderTransitionContext,
  ): Promise<OrderTransitionResult> {
    const result = await db.transaction((tx) => this.apply(tx, orderId, toStatus, ctx));
    // Idempotent replays already notified once — vesting/consumption hooks are
    // themselves idempotent, but there is no reason to re-fire them.
    if (!result.idempotentReplay) {
      await this.notify(orderId, toStatus, ctx);
    }
    return result;
  }

  /**
   * Apply a transition inside a transaction the caller already opened. Same
   * guarantees as {@link transition}, but the status change + event join the
   * caller's unit of work — so an atomic payment settlement can commit the
   * payment row, the status, the order_event and the outbox event together.
   * Infrastructure-only (takes a live tx); application code uses `transition`.
   */
  async transitionWithin(
    tx: Tx,
    orderId: string,
    toStatus: OrderStatus,
    ctx: OrderTransitionContext,
  ): Promise<OrderTransitionResult> {
    return this.apply(tx, orderId, toStatus, ctx);
  }

  private async apply(
    tx: Tx,
    orderId: string,
    toStatus: OrderStatus,
    ctx: OrderTransitionContext,
  ): Promise<OrderTransitionResult> {
    {
      const locked = await tx
        .select({ status: orders.status, paymentStatus: orders.paymentStatus })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');
      if (locked.length === 0) {
        throw new DomainError('ORDER_NOT_FOUND', 'NOT_FOUND', 'Order not found.', { clientSafe: true });
      }
      const row = locked[0];

      // Idempotent replay: a transition with this external identity already
      // committed. Return it rather than writing a duplicate event.
      if (ctx.idempotencyKey) {
        const existing = await tx
          .select({ id: orderEvents.id, fromStatus: orderEvents.fromStatus, toStatus: orderEvents.toStatus })
          .from(orderEvents)
          .where(eq(orderEvents.idempotencyKey, ctx.idempotencyKey))
          .limit(1);
        if (existing.length > 0) {
          return {
            orderId,
            fromStatus: (existing[0].fromStatus ?? row.status) as OrderStatus,
            toStatus: existing[0].toStatus as OrderStatus,
            eventId: existing[0].id,
            idempotentReplay: true,
          };
        }
      }

      const from = row.status as OrderStatus;
      // The verified payment result (when supplied) is authoritative for the gate,
      // not the stale stored value.
      const effectivePaymentStatus = (ctx.paymentStatus ?? row.paymentStatus) as PaymentStatus;
      const decision = canTransitionOrder(from, toStatus, { paymentStatus: effectivePaymentStatus });
      if (!decision.allowed) {
        // Illegal transition: the transaction commits NOTHING — no status change,
        // no payment change, no event (P0-2 AC2).
        const category = decision.code === 'UNPAID' ? 'FORBIDDEN' : 'CONFLICT';
        throw new DomainError(`ORDER_TRANSITION_${decision.code}`, category, decision.message, { clientSafe: true });
      }

      const now = new Date();
      await tx
        .update(orders)
        .set({
          status: toStatus,
          // Only override payment status when a verified result was supplied.
          paymentStatus: ctx.paymentStatus ?? undefined,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId));
      const inserted = await tx
        .insert(orderEvents)
        .values({
          orderId,
          fromStatus: from,
          toStatus,
          actorId: ctx.actorId ?? null,
          actorType: ctx.actorType,
          reasonCode: ctx.reasonCode ?? null,
          source: ctx.source,
          note: ctx.note ?? null,
          idempotencyKey: ctx.idempotencyKey ?? null,
          correlationId: ctx.correlationId ?? null,
          occurredAt: now,
        })
        .returning({ id: orderEvents.id });

      return { orderId, fromStatus: from, toStatus, eventId: inserted[0].id, idempotentReplay: false };
    }
  }

  /** Bounded, most-recent-first history for one order. Read-only. */
  async history(orderId: string, limit = 100): Promise<OrderEventRecord[]> {
    const rows = await db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(desc(orderEvents.occurredAt), desc(orderEvents.id))
      .limit(Math.max(1, Math.min(limit, 200)));
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      fromStatus: r.fromStatus ?? null,
      toStatus: r.toStatus,
      actorId: r.actorId ?? null,
      actorType: r.actorType,
      reasonCode: r.reasonCode ?? null,
      source: r.source,
      note: r.note ?? null,
      isSynthetic: r.isSynthetic,
      occurredAt: r.occurredAt,
    }));
  }
}
