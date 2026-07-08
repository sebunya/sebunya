import { db } from '../db/client';
import { telemetryDeadLetterQueue } from '../db/schema/telemetry';
import { count, eq, desc } from 'drizzle-orm';
import type { DlqRepository, DlqEntry } from '../../application/ports/measurement/DlqRepository';

export class DrizzleDlqRepository implements DlqRepository {
  async getUnresolvedCount(): Promise<number> {
    const [dlqCount] = await db.select({ count: count() }).from(telemetryDeadLetterQueue)
      .where(eq(telemetryDeadLetterQueue.isResolved, false));
    return dlqCount?.count ?? 0;
  }

  async listUnresolved(limit: number): Promise<any[]> {
    return await db
      .select()
      .from(telemetryDeadLetterQueue)
      .where(eq(telemetryDeadLetterQueue.isResolved, false))
      .orderBy(desc(telemetryDeadLetterQueue.failedAt))
      .limit(limit);
  }

  async findById(id: string): Promise<DlqEntry | null> {
    const [entry] = await db
      .select()
      .from(telemetryDeadLetterQueue)
      .where(eq(telemetryDeadLetterQueue.id, id))
      .limit(1);

    if (!entry) return null;
    return {
      id: entry.id,
      eventId: entry.eventId,
      payload: entry.payload,
      isResolved: entry.isResolved,
      failedAt: entry.failedAt,
    };
  }

  async markResolved(id: string, note: string): Promise<void> {
    await db.update(telemetryDeadLetterQueue)
      .set({ isResolved: true, resolvedAt: new Date(), resolvedNote: note })
      .where(eq(telemetryDeadLetterQueue.id, id));
  }
}
