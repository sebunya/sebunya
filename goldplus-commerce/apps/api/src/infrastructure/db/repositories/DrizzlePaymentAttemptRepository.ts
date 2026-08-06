import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { orders, paymentAttempts } from '../schema/commerce';
import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../../application/ports/IPesaPalPaymentRepository';
import { POLLABLE_ATTEMPT_STATUSES, assertAttemptTransition } from '../../../domain/payments/PaymentAttemptState';

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
    // THE state machine is enforced here, at the single write path, because
    // production held five attempts trapped in `pending` from May to August.
    // An illegal move throws — a warning on a money path is a log line nobody
    // reads. A self-loop (re-stamping timestamps) is legal.
    const current = await db.query.paymentAttempts.findFirst({ where: eq(paymentAttempts.id, id) });
    if (current) assertAttemptTransition(current.status, update.status);
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
    status: 'paid' | 'failed' | 'reversed' | 'unpaid'
  ): Promise<void> {
    // Payment status ONLY. The lifecycle `status` is never written here — that is
    // the exclusive job of OrderTransitionService, which records an order_event.
    await db
      .update(orders)
      .set({
        paymentStatus: status,
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

  /**
   * Attempts the reconciliation poller must ask the provider about: a live
   * provider transaction exists (tracking id present) and our status is still
   * non-terminal after the threshold. The provider holds truth we have not
   * heard — a customer who paid and closed the tab looks exactly like this.
   */
  async listAttemptsForReconciliation(olderThan: Date, limit: number): Promise<RecordedPaymentAttempt[]> {
    const rows = await db.query.paymentAttempts.findMany({
      where: and(
        inArray(paymentAttempts.status, [...POLLABLE_ATTEMPT_STATUSES]),
        isNotNull(paymentAttempts.orderTrackingId),
        lt(paymentAttempts.createdAt, olderThan),
      ),
      orderBy: [desc(paymentAttempts.createdAt)],
      limit: Math.max(1, Math.min(limit, 200)),
    });
    return rows.map(rowToPaymentAttempt);
  }

  /**
   * Attempts with NO tracking id: SubmitOrderRequest never succeeded, so no
   * provider transaction exists, nothing can be asked, and no money is
   * possible by construction. After the abandonment window these close as
   * `abandoned` — a statement about OUR record, never about the provider.
   */
  async listStartFailuresForAbandonment(olderThan: Date, limit: number): Promise<RecordedPaymentAttempt[]> {
    const rows = await db.query.paymentAttempts.findMany({
      where: and(
        eq(paymentAttempts.status, 'not_started'),
        isNull(paymentAttempts.orderTrackingId),
        lt(paymentAttempts.createdAt, olderThan),
      ),
      orderBy: [desc(paymentAttempts.createdAt)],
      limit: Math.max(1, Math.min(limit, 200)),
    });
    return rows.map(rowToPaymentAttempt);
  }

  async listRecent(limit: number): Promise<RecordedPaymentAttempt[]> {
    const rows = await db.query.paymentAttempts.findMany({
      orderBy: [desc(paymentAttempts.updatedAt)],
      limit: Math.max(1, Math.min(limit, 1000)),
    });
    return rows.map(rowToPaymentAttempt);
  }
}

