import { IAuditRepository } from '../../ports/IAuditRepository';

export interface AuditLogListItem {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
}

export class ListAuditLogsUseCase {
  constructor(private readonly audit: IAuditRepository) {}

  async execute(opts: { limit?: number } = {}): Promise<AuditLogListItem[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const rows = await this.audit.findAll({ limit });
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
