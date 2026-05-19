import { eq, lte, and, asc, sql } from 'drizzle-orm';
import { db } from '../client';
import { outboxEvents } from '../schema/system';
import { IOutboxRepository, PersistedOutboxEvent } from '../../../application/ports/IOutboxRepository';

function rowToPersisted(row: typeof outboxEvents.$inferSelect): PersistedOutboxEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    payload: row.payload as Record<string, unknown>,
    attemptCount: row.attemptCount,
    isProcessed: row.isProcessed,
    createdAt: row.createdAt,
    nextAttemptAt: row.nextAttemptAt,
    idempotencyKey: row.idempotencyKey,
    channel: row.channel,
    template: row.template,
    status: row.status,
    relatedEntity: row.relatedEntity,
    relatedEntityId: row.relatedEntityId,
    dryRunOnly: row.dryRunOnly,
    previewOnly: row.previewOnly,
    noSendGuarantee: row.noSendGuarantee,
    suppressedReason: row.suppressedReason,
  };
}

export class DrizzleOutboxRepository implements IOutboxRepository {
  async claimDueBatch(now: Date, limit: number): Promise<PersistedOutboxEvent[]> {
    // Use explicit SELECT to enable FOR UPDATE SKIP LOCKED concurrency safe claiming
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.isProcessed, false),
          lte(outboxEvents.nextAttemptAt, now)
        )
      )
      .orderBy(asc(outboxEvents.nextAttemptAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    return rows.map(rowToPersisted);
  }

  async markProcessed(eventId: string, opts?: { lastError?: string }): Promise<void> {
    await db
      .update(outboxEvents)
      .set({
        isProcessed: true,
        processedAt: new Date(),
        lastError: opts?.lastError ?? null,
      })
      .where(eq(outboxEvents.id, eventId));
  }

  async recordFailure(eventId: string, error: string, nextAttemptAt: Date): Promise<void> {
    await db
      .update(outboxEvents)
      .set({
        lastError: error,
        nextAttemptAt: nextAttemptAt,
        attemptCount: sql`${outboxEvents.attemptCount} + 1`,
      })
      .where(eq(outboxEvents.id, eventId));
  }

  async findByRelatedEntity(entity: string, entityId: string): Promise<PersistedOutboxEvent[]> {
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.relatedEntity, entity),
          eq(outboxEvents.relatedEntityId, entityId)
        )
      )
      .orderBy(asc(outboxEvents.createdAt));

    return rows.map(rowToPersisted);
  }
}
