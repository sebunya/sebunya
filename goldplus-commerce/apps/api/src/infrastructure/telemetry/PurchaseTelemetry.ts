import { enqueuePurchaseEvent } from '../../application/use-cases/telemetry/EnqueuePurchaseEventUseCase';
import { logger } from '../logging/logger';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import { and, eq, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { hashEmail, hashPhone } from '../advertising/AdPlatforms';

type Visitor = { fpClientId?: string | null; clientIp?: string | null; userAgent?: string | null; gaSessionId?: string | null; gaSessionNumber?: number | null };

async function dispatchNow(outboxId: string, jobKey: string) {
  const { QueueService, QUEUES } = await import('../queues/QueueService');
  await QueueService.getInstance().enqueue(QUEUES.TELEMETRY_DISPATCH, jobKey, { outboxId }, outboxId);
}

/**
 * One purchase, sent to GA4 server-side through the tagging server.
 *
 * Called when an order becomes a sale: an online order when its payment is
 * CONFIRMED (PesaPal settlement), a cash-on-delivery order when it is placed.
 * The visitor (`_fp_cid`, IP, browser) comes from the order's attribution row,
 * written at checkout by the web server that had the browser in front of it.
 *
 * Idempotent by order: the outbox key is `purchase:<order number>`, so a
 * replayed IPN, a callback AND a poll all confirming the same payment enqueue
 * one purchase. Never throws: measurement must not touch the money path.
 */
export async function queuePurchaseTelemetry(input: {
  orderId: string;
  orderNumber: string;
  valueUgx: number;
  userId?: string | null;
  visitor: Visitor | null;
  traceId?: string;
  /** The order's contact, for ad-platform matching; hashed here, never stored raw in the event. */
  email?: string | null;
  phone?: string | null;
}): Promise<void> {
  // Sent for every sale (owner decision 2026-09-19: server-side measurement is
  // always on; the browser-cookie choice does not apply to it).
  try {
    const outboxId = await enqueuePurchaseEvent({
      orderId: input.orderId,
      transactionId: input.orderNumber,
      value: input.valueUgx,
      currency: 'UGX',
      userId: input.userId ?? undefined,
      fpClientId: input.visitor?.fpClientId ?? undefined,
      ipAddress: input.visitor?.clientIp ?? undefined,
      userAgent: input.visitor?.userAgent ?? undefined,
      gaSessionId: input.visitor?.gaSessionId ?? undefined,
      gaSessionNumber: input.visitor?.gaSessionNumber ?? undefined,
      hashedEmail: hashEmail(input.email),
      hashedPhone: hashPhone(input.phone),
      traceId: input.traceId,
    });
    if (!outboxId) return; // already enqueued for this order
    await dispatchNow(outboxId, `purchase-dispatch:${input.orderId}`);
  } catch (err) {
    // The outbox ticker also sweeps undispatched rows; a queue failure here is not a lost event.
    logger.warn({ err, orderId: input.orderId }, '[Telemetry] purchase not queued');
  }
}

/**
 * A GA4 refund for an order whose purchase WAS sent and which was then
 * cancelled (a cash-on-delivery order refused at the door, a reversed
 * payment). Without it, every cancelled COD order stayed in GA4 revenue.
 *
 * Only when a purchase for the order exists in the outbox: no purchase, nothing
 * to take back. Once per order (`refund:<order number>`). Never throws.
 */
export async function queueRefundTelemetry(input: { orderId: string; orderNumber: string; valueUgx: number; visitor: Visitor | null }): Promise<void> {
  try {
    const purchase = await db.select({ id: outboxEvents.id, status: outboxEvents.status }).from(outboxEvents)
      .where(and(eq(outboxEvents.idempotencyKey, `purchase:${input.orderNumber}`), eq(outboxEvents.eventType, 'TELEMETRY_DISPATCH'))).limit(1);
    if (purchase.length === 0) return;
    if (purchase[0].status !== 'sent') {
      // Not delivered yet (pending or retrying): withdraw it instead of sending
      // a purchase and then its refund; GA never sees a sale that did not stand.
      // Dead-lettered or already withdrawn: nothing reached GA, nothing to undo.
      await db.update(outboxEvents).set({ status: 'withdrawn', isProcessed: true, processedAt: new Date() })
        .where(and(eq(outboxEvents.id, purchase[0].id), inArray(outboxEvents.status, ['pending', 'retrying'])));
      return;
    }
    const event = {
      event_name: 'refund' as const,
      event_id: crypto.randomUUID(),
      event_time: Math.floor(Date.now() / 1000),
      source: 'server' as const,
      user_data: {
        fp_client_id: input.visitor?.fpClientId ?? undefined,
        ip_address: input.visitor?.clientIp ?? undefined,
        user_agent: input.visitor?.userAgent ?? undefined,
      },
      ecommerce: { transaction_id: input.orderNumber, value: input.valueUgx, currency: 'UGX' },
    };
    const inserted = await db.insert(outboxEvents).values({
      eventType: 'TELEMETRY_DISPATCH', payload: event as any, idempotencyKey: `refund:${input.orderNumber}`,
      status: 'pending', dryRunOnly: false, relatedEntity: 'order', relatedEntityId: input.orderId,
    }).onConflictDoNothing({ target: outboxEvents.idempotencyKey }).returning({ id: outboxEvents.id });
    if (inserted[0]?.id) await dispatchNow(inserted[0].id, `refund-dispatch:${input.orderId}`);
  } catch (err) {
    logger.warn({ err, orderId: input.orderId }, '[Telemetry] refund not queued');
  }
}
