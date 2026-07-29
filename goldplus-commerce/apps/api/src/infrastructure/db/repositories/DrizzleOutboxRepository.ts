import { eq, lte, and, asc, desc, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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

/** Stable identity for this worker process, for lease ownership. */
export const WORKER_ID = `${process.env.WORKER_NAME ?? 'api'}-${process.pid}-${randomUUID().slice(0, 8)}`;

export const LEASE_DURATION_MS = 5 * 60_000;

export class DrizzleOutboxRepository implements IOutboxRepository {
  constructor(private readonly workerId: string = WORKER_ID) {}

  /**
   * Claims a batch in ONE short transaction, then returns. No external call
   * happens inside it: holding a database transaction open across a slow
   * provider request ties a connection up for the provider's timeout and blocks
   * everything behind it.
   *
   * The claim records WHO holds the event and until when. Previously ownership
   * was only implied by pushing next_attempt_at forward, which returns a crashed
   * worker's event to eligibility but leaves nothing to compare against on
   * completion — so a worker whose lease had expired could still come back and
   * overwrite the outcome recorded by its successor.
   */
  async claimDueBatch(now: Date, limit: number): Promise<PersistedOutboxEvent[]> {
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
    return db.transaction(async (tx) => {
      const rows = await tx
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
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);
      await tx.update(outboxEvents).set({
        status: 'processing',
        workerId: this.workerId,
        claimedAt: now,
        leaseExpiresAt,
        // next_attempt_at doubles as the recovery deadline: if this worker dies,
        // the event becomes claimable again once the lease has passed.
        nextAttemptAt: leaseExpiresAt,
      }).where(inArray(outboxEvents.id, ids));
      return rows.map((row) => rowToPersisted({
        ...row,
        status: 'processing',
        workerId: this.workerId,
        claimedAt: now,
        leaseExpiresAt,
        nextAttemptAt: leaseExpiresAt,
      }));
    });
  }

  /**
   * Completion, guarded by the lease.
   *
   * Returns false when this worker no longer owns the event — its lease expired
   * and another worker took over. Writing anyway would let a stale worker
   * overwrite its successor's result, including turning a delivered event back
   * into a pending one and sending it a second time.
   */
  async markProcessed(eventId: string, opts?: { lastError?: string }): Promise<boolean> {
    const updated = await db
      .update(outboxEvents)
      .set({
        isProcessed: true,
        processedAt: new Date(),
        status: 'processed',
        lastError: opts?.lastError ?? null,
        workerId: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.workerId, this.workerId)))
      .returning({ id: outboxEvents.id });
    return updated.length === 1;
  }

  /**
   * Terminal failure. The event is finished, but it was NEVER DELIVERED, and
   * recording it as 'processed' — which is what happened before — made it
   * indistinguishable from a success in every metric and every query.
   */
  async markDeadLettered(eventId: string, error: string): Promise<boolean> {
    const now = new Date();
    const updated = await db
      .update(outboxEvents)
      .set({
        isProcessed: true,
        processedAt: now,
        deadLetteredAt: now,
        status: 'dead_letter',
        lastError: error,
        workerId: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.workerId, this.workerId)))
      .returning({ id: outboxEvents.id });
    return updated.length === 1;
  }

  async recordFailure(eventId: string, error: string, nextAttemptAt: Date): Promise<boolean> {
    const updated = await db
      .update(outboxEvents)
      .set({
        lastError: error,
        status: 'pending',
        nextAttemptAt,
        attemptCount: sql`${outboxEvents.attemptCount} + 1`,
        workerId: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.workerId, this.workerId)))
      .returning({ id: outboxEvents.id });
    return updated.length === 1;
  }

  /**
   * Operational counts. Read from `status`, not from is_processed: a dead letter
   * is "finished" but it is not a delivery, and counting it as one is what hid
   * every exhausted event.
   */
  async metrics(now: Date = new Date()): Promise<{
    pending: number;
    due: number;
    processing: number;
    deadLettered: number;
    oldestPendingAgeSeconds: number | null;
    expiredLeases: number;
  }> {
    const [row] = await db
      .select({
        pending: sql<number>`count(*) filter (where is_processed = false)::int`,
        due: sql<number>`count(*) filter (where is_processed = false and next_attempt_at <= ${now})::int`,
        processing: sql<number>`count(*) filter (where status = 'processing')::int`,
        deadLettered: sql<number>`count(*) filter (where status = 'dead_letter')::int`,
        oldest: sql<number | null>`extract(epoch from (${now} - min(created_at) filter (where is_processed = false)))::int`,
        expiredLeases: sql<number>`count(*) filter (where status = 'processing' and lease_expires_at < ${now})::int`,
      })
      .from(outboxEvents);
    return {
      pending: row?.pending ?? 0,
      due: row?.due ?? 0,
      processing: row?.processing ?? 0,
      deadLettered: row?.deadLettered ?? 0,
      oldestPendingAgeSeconds: row?.oldest ?? null,
      expiredLeases: row?.expiredLeases ?? 0,
    };
  }

  async listDeadLettered(limit = 100): Promise<PersistedOutboxEvent[]> {
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.status, 'dead_letter'))
      .orderBy(desc(outboxEvents.deadLetteredAt))
      .limit(Math.min(Math.max(1, limit), 500));
    return rows.map(rowToPersisted);
  }

  /**
   * Returns a dead-lettered event to the queue.
   *
   * Idempotent by construction: the WHERE clause requires the event to still be
   * dead-lettered, so replaying the same event twice returns false the second
   * time rather than queueing two copies. The idempotency key is untouched, so
   * a consumer that already saw the original still deduplicates it.
   */
  async replayDeadLettered(eventId: string): Promise<boolean> {
    const updated = await db
      .update(outboxEvents)
      .set({
        isProcessed: false,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        deadLetteredAt: null,
        processedAt: null,
        workerId: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, 'dead_letter')))
      .returning({ id: outboxEvents.id });
    return updated.length === 1;
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
