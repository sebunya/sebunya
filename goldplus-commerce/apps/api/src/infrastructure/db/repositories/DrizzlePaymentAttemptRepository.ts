import { eq } from 'drizzle-orm';
import { db } from '../client';
import { orders, paymentAttempts } from '../schema/commerce';
import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../../application/ports/IPesaPalPaymentRepository';

function rowToPaymentAttempt(row: typeof paymentAttempts.$inferSelect): RecordedPaymentAttempt {
  return {
    id: row.id,
    orderId: row.orderId,
    merchantReference: row.merchantReference,
    orderTrackingId: row.orderTrackingId ?? null,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    redirectUrl: row.redirectUrl ?? null,
    provider: row.provider,
    ipnReceivedAt: row.ipnReceivedAt ?? null,
    callbackReceivedAt: row.callbackReceivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzlePaymentAttemptRepository implements IPesaPalPaymentRepository {
  async createPaymentAttempt(input: {
    orderId: string;
    merchantReference: string;
    amount: number;
    currency: string;
    status: string;
    redirectUrl?: string | null;
    orderTrackingId?: string | null;
  }): Promise<RecordedPaymentAttempt> {
    const [row] = await db
      .insert(paymentAttempts)
      .values({
        orderId: input.orderId,
        merchantReference: input.merchantReference,
        amount: input.amount,
        currency: input.currency,
        status: input.status,
        redirectUrl: input.redirectUrl ?? null,
        orderTrackingId: input.orderTrackingId ?? null,
      })
      .returning();
    return rowToPaymentAttempt(row);
  }

  async findByMerchantReference(merchantReference: string): Promise<RecordedPaymentAttempt | null> {
    const row = await db.query.paymentAttempts.findFirst({
      where: eq(paymentAttempts.merchantReference, merchantReference),
    });
    return row ? rowToPaymentAttempt(row) : null;
  }

  async findByTrackingId(orderTrackingId: string): Promise<RecordedPaymentAttempt | null> {
    const row = await db.query.paymentAttempts.findFirst({
      where: eq(paymentAttempts.orderTrackingId, orderTrackingId),
    });
    return row ? rowToPaymentAttempt(row) : null;
  }

  async updatePaymentAttemptStatus(id: string, update: {
    status: string;
    orderTrackingId?: string | null;
    redirectUrl?: string | null;
    ipnReceivedAt?: Date | null;
    callbackReceivedAt?: Date | null;
  }): Promise<RecordedPaymentAttempt> {
    const [row] = await db
      .update(paymentAttempts)
      .set({
        status: update.status,
        orderTrackingId: update.orderTrackingId !== undefined ? update.orderTrackingId : undefined,
        redirectUrl: update.redirectUrl !== undefined ? update.redirectUrl : undefined,
        ipnReceivedAt: update.ipnReceivedAt !== undefined ? update.ipnReceivedAt : undefined,
        callbackReceivedAt: update.callbackReceivedAt !== undefined ? update.callbackReceivedAt : undefined,
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, id))
      .returning();
    return rowToPaymentAttempt(row);
  }

  async updateOrderPaymentStatusSafely(
    orderId: string,
    status: 'paid' | 'failed' | 'reversed' | 'unpaid',
    orderStatus?: 'processing' | 'received' | 'pending_payment' | 'cancelled'
  ): Promise<void> {
    await db
      .update(orders)
      .set({
        paymentStatus: status,
        status: orderStatus !== undefined ? orderStatus : undefined,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
  }

  async findAttemptsByOrderId(orderId: string): Promise<RecordedPaymentAttempt[]> {
    const rows = await db.query.paymentAttempts.findMany({
      where: eq(paymentAttempts.orderId, orderId),
    });
    return rows.map(rowToPaymentAttempt);
  }
}

