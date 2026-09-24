import { eq, desc } from 'drizzle-orm';
import { db } from '../client';
import { notificationAttempts } from '../schema/phase11';
import { INotificationAttemptRepository, PersistedNotificationAttempt } from '../../../application/ports/INotificationAttemptRepository';
import { NotificationStatus } from '../../../application/ports/INotificationProvider';
import { toRelatedEntityId } from '../../../domain/notifications/RelatedEntityId';

/** Fitted to the columns: an over-long value made the insert throw AFTER the message was sent. */
const fit = (value: string | null | undefined, max: number): string | null =>
  value == null ? null : value.length > max ? value.slice(0, max) : value;

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
        channel: fit(input.channel, 20) ?? '',
        recipient: fit(input.recipient, 255) ?? '',
        template: fit(input.template, 100) ?? '',
        status: fit(input.status, 30) ?? 'PENDING',
        providerCode: fit(input.providerCode, 50),
        providerMessage: input.providerMessage,
        relatedEntity: fit(input.relatedEntity, 50),
        // The column is a uuid: a non-UUID reference (an order number) made the
        // insert throw after a delivered send, which re-sent it on every retry.
        relatedEntityId: toRelatedEntityId(input.relatedEntityId),
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
}
