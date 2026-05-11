import { AuditLogEntity } from '../../domain/audit/AuditLogEntity';

export interface IAuditRepository {
  save(log: AuditLogEntity): Promise<void>;
  findAll(opts?: { limit?: number }): Promise<AuditLogEntity[]>;
  findByEntity(entity: string, entityId: string): Promise<AuditLogEntity[]>;
}
