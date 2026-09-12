import { AuditLogEntity } from '../../domain/audit/AuditLogEntity';

export interface IAuditRepository {
  save(log: AuditLogEntity): Promise<void>;
  /** Optional actorId (exact) and action (case-insensitive substring) narrow the feed in the query itself. */
  findAll(opts?: { limit?: number; actorId?: string; action?: string }): Promise<AuditLogEntity[]>;
  findByEntity(entity: string, entityId: string): Promise<AuditLogEntity[]>;
}
