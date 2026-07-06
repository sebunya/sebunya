import { desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { activityEvents } from '../schema/engagement';
import {
  IActivityEventRepository,
  PersistedActivityEvent,
  EngagementCountRow,
} from '../../../application/ports/IActivityEventRepository';
import { ActivityEventType, ValidatedActivityEvent } from '../../../domain/engagement/ActivityEvent';

function rowToPersisted(row: typeof activityEvents.$inferSelect): PersistedActivityEvent {
  return {
    id: row.id,
    visitorId: row.visitorId,
    sessionId: row.sessionId ?? null,
    userId: row.userId ?? null,
    eventType: row.eventType as ActivityEventType,
    path: row.path ?? null,
    entity: row.entity ?? null,
    entityId: row.entityId ?? null,
    properties: (row.properties ?? {}) as Record<string, string | number | boolean>,
    createdAt: row.createdAt,
  };
}

export class DrizzleActivityEventRepository implements IActivityEventRepository {
  async save(event: ValidatedActivityEvent): Promise<PersistedActivityEvent> {
    const [row] = await db
      .insert(activityEvents)
      .values({
        visitorId: event.visitorId,
        sessionId: event.sessionId,
        userId: event.userId,
        eventType: event.eventType,
        path: event.path,
        entity: event.entity,
        entityId: event.entityId,
        properties: event.properties,
      })
      .returning();
    return rowToPersisted(row);
  }

  async countByTypeSince(since: Date): Promise<EngagementCountRow[]> {
    const rows = await db
      .select({
        eventType: activityEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(activityEvents)
      .where(gte(activityEvents.createdAt, since))
      .groupBy(activityEvents.eventType);
    return rows.map((r) => ({ eventType: r.eventType, count: Number(r.count) }));
  }

  async findRecentByVisitor(visitorId: string, limit: number): Promise<PersistedActivityEvent[]> {
    const capped = Math.min(Math.max(1, limit), 200);
    const rows = await db.query.activityEvents.findMany({
      where: eq(activityEvents.visitorId, visitorId),
      orderBy: [desc(activityEvents.createdAt)],
      limit: capped,
    });
    return rows.map(rowToPersisted);
  }
}
