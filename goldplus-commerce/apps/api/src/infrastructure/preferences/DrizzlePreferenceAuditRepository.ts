import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { preferenceAuditLog } from '../db/schema/preferences';
import { PreferenceAuditRepository, PreferenceAuditLogEntry } from '../../application/ports/preferences/PreferenceAuditRepository';

export class DrizzlePreferenceAuditRepository implements PreferenceAuditRepository {
  async logAudit(entry: Omit<PreferenceAuditLogEntry, 'id' | 'createdAt'>): Promise<void> {
    await db.insert(preferenceAuditLog).values({
      userId: entry.userId,
      beforeState: entry.beforeState,
      afterState: entry.afterState,
      source: entry.source,
    });
  }

  async getAuditTrail(userId: string): Promise<PreferenceAuditLogEntry[]> {
    const rows = await db.select().from(preferenceAuditLog)
      .where(eq(preferenceAuditLog.userId, userId))
      .orderBy(desc(preferenceAuditLog.createdAt))
      .limit(100);

    return rows.map(r => ({
      id: r.id,
      userId: r.userId,
      beforeState: r.beforeState as any,
      afterState: r.afterState as any,
      source: r.source,
      createdAt: r.createdAt
    }));
  }
}
