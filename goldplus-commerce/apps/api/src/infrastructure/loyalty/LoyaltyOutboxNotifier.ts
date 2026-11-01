import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema/identity';
import { outboxEvents } from '../db/schema/system';

/**
 * Loyalty customer messaging through the EXISTING transactional outbox
 * (loyalty brief PART M — no parallel messaging path). Events are routed by
 * NotificationRouter (SMS ahead of email; WhatsApp API is a deferred channel)
 * and delivery is governed by the same outbound-governance gates as every
 * other customer message — a loyalty enqueue can never bypass consent
 * machinery, and when the gates are closed the attempt is truthfully
 * suppressed rather than silently pretended.
 */
export class LoyaltyOutboxNotifier {
  /**
   * @returns 'sent' when an outbox intent was enqueued (delivery then governed
   * downstream), 'skipped' when the user has no reachable contact.
   */
  async enqueue(input: {
    userId: string;
    eventType:
      | 'LOYALTY_EXPIRY_WARNING'
      | 'LOYALTY_POINTS_EARNED'
      | 'LOYALTY_REDEMPTION_CONFIRMED'
      | 'LOYALTY_REDEMPTION_REVERSED'
      | 'LOYALTY_TIER_CHANGED';
    idempotencyKey: string;
    data: Record<string, unknown>;
  }): Promise<'sent' | 'skipped'> {
    const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
    if (!user || (!user.email && !user.phone)) return 'skipped';
    const channel = user.phone ? 'sms' : 'email';
    await db
      .insert(outboxEvents)
      .values({
        eventType: input.eventType,
        payload: {
          ...input.data,
          customerEmail: user.email ?? null,
          customerPhone: user.phone ?? null,
        } as never,
        idempotencyKey: input.idempotencyKey,
        status: 'pending',
        channel,
        template: input.eventType,
        dryRunOnly: false,
        relatedEntity: 'loyalty',
        relatedEntityId: input.userId,
      })
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey });
    return 'sent';
  }
}
