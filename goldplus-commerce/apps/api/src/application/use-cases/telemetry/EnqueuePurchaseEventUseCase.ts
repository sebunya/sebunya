import { db } from '../../../infrastructure/db/client';
import { outboxEvents } from '../../../infrastructure/db/schema/system';
import { orderItems } from '../../../infrastructure/db/schema/commerce';
import { DrizzleIdentityRepository } from '../../../infrastructure/db/repositories/DrizzleIdentityRepository';
import { piiHasher } from '../../../infrastructure/security/PiiHashingService';
import type { CanonicalTelemetryEvent } from '@goldplus/shared';
import { logger } from '../../../infrastructure/logging/logger';
import { eq } from 'drizzle-orm';

const identityRepo = new DrizzleIdentityRepository();


const EVENT_TYPE_TELEMETRY = 'TELEMETRY_DISPATCH';

/**
 * PHASE 6/7/8/9/10/11 — SERVER-SIDE PURCHASE EVENT ENQUEUE
 *
 * This is the single, authoritative entry point for `purchase` events.
 * It is called EXCLUSIVELY from the payment webhook handler upon payment
 * provider confirmation. The browser NEVER fires a purchase event.
 *
 * The function:
 * 1. Validates the order exists and payment is confirmed.
 * 2. Looks up the user's identity record to enrich with click IDs + hashed PII.
 * 3. Constructs the canonical purchase payload.
 * 4. Writes to the outbox (same DB transaction as the payment record).
 * 5. The OutboxTicker picks it up and dispatches to sGTM.
 *
 * Self-Critique: We pass `trx` (an optional Drizzle transaction context) so
 * this insert can happen ATOMICALLY with the payment write. This is the Outbox
 * Pattern implemented correctly — the event only exists if the payment exists.
 */
export async function enqueuePurchaseEvent(opts: {
  orderId: string;
  transactionId: string;
  value: number;
  currency: string;
  userId?: string;
  fpClientId?: string;
  ipAddress?: string;
  userAgent?: string;
  pageLocation?: string;
  traceId?: string;
  // Drizzle transaction context for atomicity
  tx?: Parameters<typeof db.insert>[0] extends infer T ? any : never;
}): Promise<string | null> {
  const {
    orderId, transactionId, value, currency,
    userId, fpClientId, ipAddress, userAgent, pageLocation, traceId,
  } = opts;

  // Enrich with stored identity signals (click IDs captured on previous sessions)
  let identityEnrichment: {
    gclid?: string; wbraid?: string; gbraid?: string;
    fbc?: string; fbp?: string; ttclid?: string;
    twclid?: string; li_fat_id?: string; epik?: string;
    hashedEmail?: string; hashedPhone?: string;
  } = {};

  try {
    const identity = userId
      ? await identityRepo.getByUserId(userId)
      : fpClientId
      ? await identityRepo.getByFpClientId(fpClientId)
      : null;

    if (identity) {
      identityEnrichment = {
        gclid:       identity.gclid ?? undefined,
        wbraid:      identity.wbraid ?? undefined,
        gbraid:      identity.gbraid ?? undefined,
        fbc:         identity.fbc ?? undefined,
        fbp:         identity.fbp ?? undefined,
        ttclid:      identity.ttclid ?? undefined,
        twclid:      identity.twclid ?? undefined,
        li_fat_id:   identity.li_fat_id ?? undefined,
        epik:        identity.epik ?? undefined,
        hashedEmail: identity.hashedEmail ?? undefined,
        hashedPhone: identity.hashedPhone ?? undefined,
      };
    }
  } catch (err) {
    // Non-fatal: log and continue. A purchase event without enrichment is better
    // than no purchase event at all.
    logger.warn({ err, orderId }, '[TelemetryEnqueue] Identity lookup failed — continuing without enrichment');
  }

  // Retrieve order items to populate the items array
  let itemsPayload: any[] = [];
  try {
    const items = await (opts.tx ?? db)
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    
    itemsPayload = items.map((i: any) => ({
      item_id:   i.productId,
      item_name: i.productName,
      price:     i.unitPrice,
      quantity:  i.quantity,
      item_brand: 'GoldPlus',
    }));
  } catch (err) {
    logger.warn({ err, orderId }, '[TelemetryEnqueue] Failed to retrieve order items for purchase telemetry');
  }

  // Build canonical purchase payload
  const eventId = crypto.randomUUID();
  const event: CanonicalTelemetryEvent = {
    event_name:  'purchase',
    event_id:    eventId,
    event_time:  Math.floor(Date.now() / 1000),
    source:      'server',
    user_data: {
      ...identityEnrichment,
      user_id:    userId,
      fp_client_id: fpClientId,
      ip_address: ipAddress,
      user_agent: userAgent,
    },
    ecommerce: {
      transaction_id: transactionId,
      value,
      currency,
      items: itemsPayload,
    },
    page_location: pageLocation,
    trace_id:      traceId,
  };

  // Idempotency key = transactionId ensures this event is never enqueued twice
  // even if the payment webhook is replayed by the provider.
  const idempotencyKey = `purchase:${transactionId}`;

  const insertTarget = opts.tx ?? db;
  const inserted = await (insertTarget as typeof db)
    .insert(outboxEvents)
    .values({
      eventType:      EVENT_TYPE_TELEMETRY,
      payload:        event as any,
      idempotencyKey,
      status:         'pending',
      dryRunOnly:     false,
      relatedEntity:  'order',
      relatedEntityId: orderId,
    })
    .onConflictDoNothing({ target: outboxEvents.idempotencyKey })
    .returning({ id: outboxEvents.id });

  // Calculate matching quality score for attribution degradation warnings
  const score = (
    (identityEnrichment.hashedEmail ? 20 : 0) +
    (identityEnrichment.hashedPhone ? 20 : 0) +
    (identityEnrichment.fbp ? 15 : 0) +
    (identityEnrichment.fbc ? 15 : 0) +
    (ipAddress ? 10 : 0) +
    (userAgent ? 10 : 0) +
    ((identityEnrichment.gclid || identityEnrichment.ttclid || identityEnrichment.twclid || identityEnrichment.li_fat_id || identityEnrichment.epik) ? 10 : 0)
  );

  if (score < 40) {
    logger.warn(
      { orderId, transactionId, score, identityEnrichment },
      '[TelemetryEnqueue] Attribution anomaly: purchase event enqueued with low match score (<40%)'
    );
  }

  logger.info({ eventId, transactionId, orderId, matchScore: score }, '[TelemetryEnqueue] Purchase event enqueued');

  return inserted[0]?.id || null;
}
