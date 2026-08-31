import { db } from '../client';
import { auditEntityId } from '../../../domain/audit/AuditEntityId';
import { auditLogs } from '../schema/system';
import { eq, desc } from 'drizzle-orm';
import { AuditLogEntity } from '../../../domain/audit/AuditLogEntity';
import { IAuditRepository } from '../../../application/ports/IAuditRepository';

export class DrizzleAuditRepository implements IAuditRepository {
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

  async findAll(opts?: { limit?: number }): Promise<AuditLogEntity[]> {
    const results = await db.query.auditLogs.findMany({
      orderBy: [desc(auditLogs.createdAt)],
      limit: opts?.limit,
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
      // The same mapping the writer uses, so a singleton's history is findable
      // by the name the route knows it by.
      where: eq(auditLogs.entityId, auditEntityId(entity, entityId)),
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

