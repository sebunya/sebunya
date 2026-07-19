import { eq, lte, and, asc, desc, sql } from 'drizzle-orm';
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
    lastError: row.lastError,
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

  async enqueueAdminOrderEmail(input: {
    idempotencyKey: string;
    payload: Record<string, unknown>;
    relatedEntityId: string;
  }): Promise<{ enqueued: boolean }> {
    const inserted = await db
      .insert(outboxEvents)
      .values({
        eventType: 'ADMIN_ORDER_EMAIL',
        payload: input.payload as any,
        idempotencyKey: input.idempotencyKey,
        status: 'pending',
        channel: 'email',
        template: 'ADMIN_ORDER_EMAIL',
        dryRunOnly: true,
        relatedEntity: 'order',
        relatedEntityId: input.relatedEntityId,
      })
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey })
      .returning({ id: outboxEvents.id });
    return { enqueued: inserted.length > 0 };
  }

  async findById(eventId: string): Promise<PersistedOutboxEvent | null> {
    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).limit(1);
    return row ? rowToPersisted(row) : null;
  }

  async listByEventType(eventType: string, limit: number): Promise<PersistedOutboxEvent[]> {
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, eventType))
      .orderBy(desc(outboxEvents.createdAt))
      .limit(limit);
    return rows.map(rowToPersisted);
  }

  async requeueForReplay(eventId: string, now: Date): Promise<boolean> {
    // Replay only a processed event that carries an error (failed / exhausted /
    // suppressed). A cleanly SENT event has last_error IS NULL and is never
    // re-sent; a still-pending event needs no replay.
    const updated = await db
      .update(outboxEvents)
      .set({ isProcessed: false, processedAt: null, status: 'pending', nextAttemptAt: now, attemptCount: 0, lastError: null })
      .where(
        and(
          eq(outboxEvents.id, eventId),
          eq(outboxEvents.isProcessed, true),
          sql`${outboxEvents.lastError} is not null`
        )
      )
      .returning({ id: outboxEvents.id });
    return updated.length > 0;
  }
}
