import { eq, desc, and } from 'drizzle-orm';
import { db } from '../client';
import { notificationAttempts } from '../schema/phase11';
import { INotificationAttemptRepository, PersistedNotificationAttempt } from '../../../application/ports/INotificationAttemptRepository';
import { NotificationStatus } from '../../../application/ports/INotificationProvider';

function rowToPersisted(row: typeof notificationAttempts.$inferSelect): PersistedNotificationAttempt {
  return {
    id: row.id,
    channel: row.channel,
    recipient: row.recipient,
    template: row.template,
    status: row.status as NotificationStatus,
    providerCode: row.providerCode ?? null,
    providerMessage: row.providerMessage ?? null,
    relatedEntity: row.relatedEntity ?? null,
    relatedEntityId: row.relatedEntityId ?? null,
    attemptedAt: row.attemptedAt,
  };
}

export class DrizzleNotificationAttemptRepository implements INotificationAttemptRepository {
  async save(input: Omit<PersistedNotificationAttempt, 'id' | 'attemptedAt'>): Promise<PersistedNotificationAttempt> {
    const [row] = await db
      .insert(notificationAttempts)
      .values({
        channel: input.channel,
        recipient: input.recipient,
        template: input.template,
        status: input.status,
        providerCode: input.providerCode,
        providerMessage: input.providerMessage,
        relatedEntity: input.relatedEntity,
        relatedEntityId: input.relatedEntityId,
      })
      .returning();
    return rowToPersisted(row);
  }

  async findRecent(opts: { limit: number }): Promise<PersistedNotificationAttempt[]> {
    const limit = Math.min(Math.max(1, opts.limit), 200);
    const rows = await db.query.notificationAttempts.findMany({
      orderBy: [desc(notificationAttempts.attemptedAt)],
      limit,
    });
    return rows.map(rowToPersisted);
  }

  async findByRelatedEntity(entity: string, entityId: string): Promise<PersistedNotificationAttempt[]> {
    const rows = await db.query.notificationAttempts.findMany({
      where: (t, { and, eq }) => and(eq(t.relatedEntity, entity), eq(t.relatedEntityId, entityId)),
      orderBy: [desc(notificationAttempts.attemptedAt)],
    });
    return rows.map(rowToPersisted);
  }

  /**
   * Compare-and-set on the attempt's status.
   *
   * The expected status is IN the WHERE clause, so PostgreSQL decides the race
   * rather than whichever worker happened to read first. A stale writer matches
   * no row and is told so; it must not proceed as though it had won.
   *
   * The legality of the edge itself is a domain question, checked by the caller
   * against AttemptLifecycle — this layer's job is only to make the write
   * atomic and honest about whether it happened.
   */
  async transitionStatus(input: {
    attemptId: string;
    expectedStatus: NotificationStatus;
    nextStatus: NotificationStatus;
    providerCode?: string | null;
    providerMessage?: string | null;
  }): Promise<boolean> {
    const updated = await db
      .update(notificationAttempts)
      .set({
        status: input.nextStatus,
        ...(input.providerCode !== undefined ? { providerCode: input.providerCode } : {}),
        ...(input.providerMessage !== undefined ? { providerMessage: input.providerMessage } : {}),
      })
      .where(
        and(
          eq(notificationAttempts.id, input.attemptId),
          eq(notificationAttempts.status, input.expectedStatus),
        ),
      )
      .returning({ id: notificationAttempts.id });

    return updated.length === 1;
  }
}
