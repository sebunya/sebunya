import { db } from '../client';
import { auditLogs } from '../schema/system';
import { eq, desc } from 'drizzle-orm';
import { AuditLogEntity } from '../../../domain/audit/AuditLogEntity';

export class DrizzleAuditRepository {
  async save(log: AuditLogEntity): Promise<void> {
    await db.insert(auditLogs).values({
      id: log.id,
      actorId: log.actorId,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      previousState: log.previousState,
      newState: log.newState,
      createdAt: log.createdAt,
    });
  }

  async findAll(): Promise<AuditLogEntity[]> {
    const results = await db.query.auditLogs.findMany({
      orderBy: [desc(auditLogs.createdAt)],
    });

    return results.map(r => new AuditLogEntity(
      r.id,
      r.actorId,
      r.action,
      r.entity,
      r.entityId,
      r.previousState,
      r.newState,
      r.createdAt
    ));
  }

  async findByEntity(entity: string, entityId: string): Promise<AuditLogEntity[]> {
    const results = await db.query.auditLogs.findMany({
      where: eq(auditLogs.entityId, entityId),
      orderBy: [desc(auditLogs.createdAt)],
    });

    return results.map(r => new AuditLogEntity(
      r.id,
      r.actorId,
      r.action,
      r.entity,
      r.entityId,
      r.previousState,
      r.newState,
      r.createdAt
    ));
  }
}
