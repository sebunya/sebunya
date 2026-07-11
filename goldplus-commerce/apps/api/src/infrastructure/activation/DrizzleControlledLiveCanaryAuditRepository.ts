import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import { LiveCanaryAuditEvent, ControlledLiveCanaryAuditRepository } from '../../application/ports/activation/ControlledLiveCanaryAuditRepository.js';

export class DrizzleControlledLiveCanaryAuditRepository implements ControlledLiveCanaryAuditRepository {
  async recordAuditEvent(event: Omit<LiveCanaryAuditEvent, 'timestamp'>): Promise<LiveCanaryAuditEvent> {
    const timestamp = new Date();
    await db.insert(schema.controlledLiveCanaryAuditLogs).values({
      id: event.id,
      canaryId: event.canaryId,
      action: event.action,
      actorAdminId: event.actorAdminId,
      reason: event.reason || null,
      timestamp
    });

    return {
      ...event,
      timestamp
    };
  }

  async getAuditEventsForCanary(canaryId: string): Promise<LiveCanaryAuditEvent[]> {
    const rows = await db.select()
      .from(schema.controlledLiveCanaryAuditLogs)
      .where(eq(schema.controlledLiveCanaryAuditLogs.canaryId, canaryId));

    return rows.map(r => ({
      id: r.id,
      canaryId: r.canaryId,
      action: r.action,
      actorAdminId: r.actorAdminId,
      reason: r.reason,
      timestamp: r.timestamp
    }));
  }
}
