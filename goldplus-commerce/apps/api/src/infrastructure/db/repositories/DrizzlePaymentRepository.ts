import { and, desc, eq, notInArray } from 'drizzle-orm';
import { db } from '../client';
import { orders, payments } from '../schema/commerce';
import { outboxEvents } from '../schema/system';
import { IPaymentRepository, PaymentWebhookOutcome, RecordedPayment } from '../../../application/ports/IPaymentRepository';
import { OrderTransitionService } from '../../orders/OrderTransitionService';
import { DOMAIN_EVENTS } from '@goldplus/shared';

function rowToPayment(row: typeof payments.$inferSelect): RecordedPayment {
  return {
    id: row.id,
    orderId: row.orderId,
    idempotencyKey: row.idempotencyKey,
    provider: row.provider,
    providerReference: row.providerReference ?? null,
    amount: row.amount,
    status: row.status as PaymentWebhookOutcome,
    paidAt: row.paidAt ?? null,
    createdAt: row.createdAt,
  };
}

/** The order states a successful payment may move to processing (OrderStateMachine). */
const PAYABLE_ORDER_STATUSES: readonly string[] = ['received', 'pending_payment', 'pending_owner_review'];

export class DrizzlePaymentRepository implements IPaymentRepository {
  // Infra-to-infra composition: a successful settlement transitions the order
  // through the ONE canonical path, enlisted in THIS repository's transaction so
  // payment + status + order_event + outbox commit together.
  constructor(private readonly orderTransition: OrderTransitionService = new OrderTransitionService()) {}

  async findByIdempotencyKey(idempotencyKey: string): Promise<RecordedPayment | null> {
    const row = await db.query.payments.findFirst({
      where: eq(payments.idempotencyKey, idempotencyKey),
    });
    return row ? rowToPayment(row) : null;
  }

  async findAll(): Promise<RecordedPayment[]> {
    const rows = await db.query.payments.findMany({
      orderBy: [desc(payments.createdAt)],
    });
    return rows.map(rowToPayment);
  }

  async recordWebhookOutcome(input: {
    orderId: string;
    idempotencyKey: string;
    provider: string;
    providerReference: string | null;
    amount: number;
    outcome: PaymentWebhookOutcome;
    signatureVerified?: boolean;
    requiresReview?: boolean;
  }): Promise<RecordedPayment> {
    const signatureVerified = input.signatureVerified ?? true;
    const requestedReview = input.requiresReview ?? false;
    // Resolve the matching order: do NOT create one here.
    // Webhooks must operate on existing orders only.
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, input.orderId),
    });
    if (!order) {
      throw new Error(`MISSING_ORDER: orderId ${input.orderId} not found`);
    }

    // A second SUCCESS under a NEW reference for an order already paid is either
    // a double charge or a provider re-send; both need a person. It used to
    // reach the order transition, which threw, rolling back the payment row and
    // answering the provider with a 500 so it retried forever. It is recorded,
    // flagged for review, and moves nothing.
    try {
      const inserted = await db.transaction(async (tx) => {
        const paidAt = input.outcome === 'SUCCESS' ? new Date() : null;
        // Decided on the LOCKED row, not the read above: two webhooks for the
        // same order (a declined first prompt, a paid second one) race here.
        const [locked] = await tx
          .select({ status: orders.status, paymentStatus: orders.paymentStatus })
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .for('update');
        const alreadyPaid = input.outcome === 'SUCCESS' && locked?.paymentStatus === 'paid';
        // Money for an order that can no longer move to processing (cancelled
        // by the abandonment sweep, or a cash order already being processed)
        // made the transition throw, which rolled back the payment row: the
        // money arrived and nothing recorded it. It is recorded for a person,
        // as PesaPal's lifecycle conflicts are.
        const cannotProcess = input.outcome === 'SUCCESS' && !!locked && !PAYABLE_ORDER_STATUSES.includes(locked.status as string);
        const requiresReview = requestedReview || alreadyPaid || cannotProcess;

        const [row] = await tx
          .insert(payments)
          .values({
            orderId: input.orderId,
            idempotencyKey: input.idempotencyKey,
            provider: input.provider,
            providerReference: input.providerReference,
            amount: input.amount,
            status: input.outcome,
            paidAt,
            signatureVerified,
            requiresReview,
          })
          .returning();

        // An unauthenticated payment does NOT move the order.
        //
        // Grace mode records the payment row so there is a trail, but marking
        // the order paid on the strength of a webhook nobody could authenticate
        // would make "held for manual review" a phrase with nothing behind it —
        // the order would progress to fulfilment exactly as if the payment were
        // proven. The order advances when a human confirms the payment.
        if (!requiresReview) {
          if (input.outcome === 'SUCCESS') {
            // Legal lifecycle move to processing, through the ONE canonical path,
            // enlisted in this transaction: payment status + status + exactly one
            // order_event commit atomically with the payment row and outbox event.
            await this.orderTransition.transitionWithin(tx, input.orderId, 'processing', {
              actorType: 'payment_provider',
              source: 'payment',
              reasonCode: `${input.provider}_payment_success`,
              paymentStatus: 'paid',
              idempotencyKey: `payment:success:${input.idempotencyKey}`,
              correlationId: input.providerReference ?? undefined,
            });
          } else {
            // A failed payment authorises NO lifecycle move (received ->
            // pending_payment is not a legal transition). Record the payment
            // status only; no order_event is invented.
            // Never over a paid or reversed order: a late FAILED for an earlier
            // declined prompt used to mark a paid order failed
            // (orderPaymentWriteDecision: paid may only become reversed).
            await tx
              .update(orders)
              .set({ paymentStatus: 'failed', updatedAt: new Date() })
              .where(and(eq(orders.id, input.orderId), notInArray(orders.paymentStatus, ['paid', 'reversed'])));
          }
        }

        // No domain event for an unreviewed payment either: PAYMENT_SUCCESS is
        // what downstream consumers act on, and none of them should act on a
        // payment that has not been authenticated.
        let outboxId: string | null = null;
        if (requiresReview) return { row, outboxId };

        const [outboxRow] = await tx.insert(outboxEvents).values({
          eventType: input.outcome === 'SUCCESS' ? DOMAIN_EVENTS.PAYMENT_SUCCESS : DOMAIN_EVENTS.PAYMENT_FAILED,
          payload: {
            paymentId: row.id,
            orderId: input.orderId,
            provider: input.provider,
            providerReference: input.providerReference,
            amount: input.amount,
            idempotencyKey: input.idempotencyKey,
          },
        }).returning({ id: outboxEvents.id });

        if (outboxRow) {
          outboxId = outboxRow.id;
        }

        return { row, outboxId };
      });

      if (inserted.outboxId) {
        const { QueueService, QUEUES } = await import('../../queues/QueueService');
        // Not awaited: the outbox row committed with the payment, and a Redis
        // outage must not hold the provider's webhook open (enqueue is bounded,
        // but the webhook answer does not depend on it at all).
        void QueueService.getInstance().enqueue(
          QUEUES.EMAIL_JOBS,
          `payment-notification:${inserted.outboxId}`,
          { outboxId: inserted.outboxId },
          inserted.outboxId
        ).catch(err => console.error('[PaymentRepository] Failed to enqueue payment email job:', err));
      }

      return rowToPayment(inserted.row);
    } catch (err) {
      // Race condition: a concurrent webhook beat us to the UNIQUE insert.
      // Re-read the existing row and return it — replay semantics.
      const message = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique constraint|UNIQUE/i.test(message)) {
        const existing = await this.findByIdempotencyKey(input.idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }
  }
}

