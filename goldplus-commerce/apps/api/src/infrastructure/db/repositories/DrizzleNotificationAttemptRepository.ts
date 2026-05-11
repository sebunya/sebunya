import { eq, desc } from 'drizzle-orm';
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
}
