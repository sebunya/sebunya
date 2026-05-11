import { eq } from 'drizzle-orm';
import { db } from '../client';
import { orders, payments } from '../schema/commerce';
import { outboxEvents } from '../schema/system';
import { IPaymentRepository, PaymentWebhookOutcome, RecordedPayment } from '../../../application/ports/IPaymentRepository';
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
  };
}

export class DrizzlePaymentRepository implements IPaymentRepository {
  async findByIdempotencyKey(idempotencyKey: string): Promise<RecordedPayment | null> {
    const row = await db.query.payments.findFirst({
      where: eq(payments.idempotencyKey, idempotencyKey),
    });
    return row ? rowToPayment(row) : null;
  }

  async recordWebhookOutcome(input: {
    orderId: string;
    idempotencyKey: string;
    provider: string;
    providerReference: string | null;
    amount: number;
    outcome: PaymentWebhookOutcome;
  }): Promise<RecordedPayment> {
    // Resolve the matching order: do NOT create one here.
    // Webhooks must operate on existing orders only.
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, input.orderId),
    });
    if (!order) {
      throw new Error(`MISSING_ORDER: orderId ${input.orderId} not found`);
    }

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
          })
          .returning();

        await tx
          .update(orders)
          .set({ status: input.outcome === 'SUCCESS' ? 'PAID' : 'PAYMENT_FAILED' })
          .where(eq(orders.id, input.orderId));

        await tx.insert(outboxEvents).values({
          eventType: input.outcome === 'SUCCESS' ? DOMAIN_EVENTS.PAYMENT_SUCCESS : DOMAIN_EVENTS.PAYMENT_FAILED,
          payload: {
            paymentId: row.id,
            orderId: input.orderId,
            provider: input.provider,
            providerReference: input.providerReference,
            amount: input.amount,
            idempotencyKey: input.idempotencyKey,
          },
        });

        return row;
      });

      return rowToPayment(inserted);
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
