import { enqueuePurchaseEvent } from '../../application/use-cases/telemetry/EnqueuePurchaseEventUseCase';
import { logger } from '../logging/logger';

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
  visitor: { fpClientId?: string | null; clientIp?: string | null; userAgent?: string | null } | null;
  traceId?: string;
}): Promise<void> {
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
      traceId: input.traceId,
    });
    if (!outboxId) return; // already enqueued for this order
    const { QueueService, QUEUES } = await import('../queues/QueueService');
    await QueueService.getInstance().enqueue(QUEUES.TELEMETRY_DISPATCH, `purchase-dispatch:${input.orderId}`, { outboxId }, outboxId);
  } catch (err) {
    // The outbox ticker also sweeps undispatched rows; a queue failure here is not a lost event.
    logger.warn({ err, orderId: input.orderId }, '[Telemetry] purchase not queued');
  }
}
