import { eq, desc } from 'drizzle-orm';
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
    const alreadyPaid = input.outcome === 'SUCCESS' && order.paymentStatus === 'paid';
    const requiresReview = requestedReview || alreadyPaid;

    try {
      const inserted = await db.transaction(async (tx) => {
        const paidAt = input.outcome === 'SUCCESS' ? new Date() : null;

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
            await tx
              .update(orders)
              .set({ paymentStatus: 'failed', updatedAt: new Date() })
              .where(eq(orders.id, input.orderId));
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
        await QueueService.getInstance().enqueue(
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

