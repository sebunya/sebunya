import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { orders, paymentAttempts } from '../schema/commerce';
import { paymentRefunds } from '../schema/commerce';
import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../../application/ports/IPesaPalPaymentRepository';
import { POLLABLE_ATTEMPT_STATUSES, assertAttemptTransition } from '../../../domain/payments/PaymentAttemptState';
import { orderPaymentWriteDecision } from '../../../domain/payments/OrderPaymentState';
import type { AttemptNumbering, FailureReasonRecord } from '../../../domain/payments/PaymentFailureReason';
import { logger } from '../../logging/logger';

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
    providerStatusCode: row.providerStatusCode ?? null,
    providerStatusDescription: row.providerStatusDescription ?? null,
    failedAt: row.failedAt ?? null,
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
    /** Omitted: only the timestamps are stamped and the current status stands. */
    status?: string;
    orderTrackingId?: string | null;
    redirectUrl?: string | null;
    ipnReceivedAt?: Date | null;
    callbackReceivedAt?: Date | null;
    providerConfirmed?: boolean;
  }): Promise<RecordedPaymentAttempt> {
    // THE state machine is enforced here, at the single write path, because
    // production held five attempts trapped in `pending` from May to August.
    // An illegal move throws — a warning on a money path is a log line nobody
    // reads. A self-loop (re-stamping timestamps) is legal.
    //
    // Checked and written under a row lock: the callback and the IPN arrive
    // within milliseconds, and an unlocked read let one write its decision
    // over the other's newer status (completed put back to pending).
    return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: paymentAttempts.status }).from(paymentAttempts).where(eq(paymentAttempts.id, id)).for('update');
    const nextStatus = update.status ?? current?.status;
    if (current && update.status !== undefined) assertAttemptTransition(current.status, update.status, { providerConfirmed: update.providerConfirmed });
    const [row] = await tx
      .update(paymentAttempts)
      .set({
        status: nextStatus,
        orderTrackingId: update.orderTrackingId !== undefined ? update.orderTrackingId : undefined,
        redirectUrl: update.redirectUrl !== undefined ? update.redirectUrl : undefined,
        ipnReceivedAt: update.ipnReceivedAt !== undefined ? update.ipnReceivedAt : undefined,
        callbackReceivedAt: update.callbackReceivedAt !== undefined ? update.callbackReceivedAt : undefined,
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, id))
      .returning();
    return rowToPaymentAttempt(row);
    });
  }

  async updateOrderPaymentStatusSafely(
    orderId: string,
    status: 'paid' | 'failed' | 'reversed' | 'unpaid'
  ): Promise<boolean> {
    // Payment status ONLY. The lifecycle `status` is never written here — that is
    // the exclusive job of OrderTransitionService, which records an order_event.
    //
    // "Safely" now means something: an order can hold a DECLINED attempt and the
    // one that paid, and the provider retries its notifications, so a late word
    // about the declined sibling used to write `failed` over `paid` and un-pay a
    // paid order. A refused move is normal, not an error — it is logged and
    // skipped, never thrown, so a provider retry cannot become a 500.
    // Decided on the LOCKED row (two notifications race here).
    return db.transaction(async (tx) => {
      const [current] = await tx.select({ paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, orderId)).for('update');
      const decision = orderPaymentWriteDecision(String(current?.paymentStatus ?? ''), status);
      if (!decision.write) {
        logger.warn(
          { orderId, from: current?.paymentStatus, to: status, reason: decision.reason },
          '[payments] order payment status write refused: a later fact about the money already stands',
        );
        return false;
      }
      await tx
        .update(orders)
        .set({
          paymentStatus: status,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
      return true;
    });
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
  async listCompletedAttemptsAwaitingRefund(limit: number): Promise<RecordedPaymentAttempt[]> {
    const rows = await db
      .select({ attempt: paymentAttempts })
      .from(paymentAttempts)
      .innerJoin(paymentRefunds, eq(paymentRefunds.paymentAttemptId, paymentAttempts.id))
      // Only a refund the provider ACCEPTED is something to watch land; one
      // whose call failed waits for a person, and polling it forever would
      // only (wrongly) settle it on the next REVERSED status.
      .where(and(eq(paymentAttempts.status, 'completed'), eq(paymentRefunds.status, 'requested'), eq(paymentRefunds.providerStatus, '200'), isNotNull(paymentAttempts.orderTrackingId)))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(Math.max(1, Math.min(limit, 200)));
    const seen = new Set<string>();
    return rows.map((r) => r.attempt).filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))).map(rowToPaymentAttempt);
  }

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

  async recordFailureReason(id: string, reason: FailureReasonRecord): Promise<void> {
    // The WHERE is the guard, not a pre-read: a completed attempt is never
    // overwritten, even if it completed between our read and this write.
    await db
      .update(paymentAttempts)
      .set({
        providerStatusCode: reason.providerStatusCode,
        providerStatusDescription: reason.providerStatusDescription,
        // First failure time stands: a repeated callback, IPN or admin re-verify
        // of the same failed attempt must not move it forward.
        failedAt: sql`coalesce(${paymentAttempts.failedAt}, ${reason.failedAt.toISOString()}::timestamptz)`,
      })
      .where(and(eq(paymentAttempts.id, id), sql`${paymentAttempts.status} <> 'completed'`));
  }

  async numberAttempts(attemptIds: string[]): Promise<AttemptNumbering[]> {
    if (attemptIds.length === 0) return [];
    const ids = sql.join(attemptIds.map((a) => sql`${a}::uuid`), sql`, `);
    const result = await db.execute(sql`
      SELECT id, attempt_number, attempts_for_order FROM (
        SELECT id,
          ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at, id)::int AS attempt_number,
          COUNT(*) OVER (PARTITION BY order_id)::int AS attempts_for_order
        FROM payment_attempts
        WHERE order_id IN (SELECT order_id FROM payment_attempts WHERE id IN (${ids}))
      ) numbered
      WHERE id IN (${ids})
    `);
    const rows = ((result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      attemptNumber: Number(r.attempt_number),
      attemptsForOrder: Number(r.attempts_for_order),
    }));
  }
}
