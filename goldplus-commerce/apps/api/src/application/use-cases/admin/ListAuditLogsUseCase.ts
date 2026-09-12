import { IAuditRepository } from '../../ports/IAuditRepository';

export interface AuditLogListItem {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
  /** Old/new values as recorded, so an operator can see what actually changed. */
  previousState: unknown;
  newState: unknown;
}

export interface ListAuditLogsOptions {
  limit?: number;
  /** Both together select one record's history (the repository's per-entity index). */
  entity?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
}

export class ListAuditLogsUseCase {
  constructor(private readonly audit: IAuditRepository) {}

  async execute(opts: ListAuditLogsOptions = {}): Promise<AuditLogListItem[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const entity = opts.entity?.trim();
    const entityId = opts.entityId?.trim();
    // One record's history comes from the per-entity index (bounded by that
    // record's own rows); otherwise the recent feed. Actor/action narrow either.
    const source = entity && entityId
      ? await this.audit.findByEntity(entity, entityId)
      : await this.audit.findAll({ limit: opts.actorId || opts.action ? 200 : limit });
    const actorId = opts.actorId?.trim();
    const action = opts.action?.trim().toUpperCase();
    const rows = source
      .filter((r) => (!actorId || r.actorId === actorId) && (!action || r.action.toUpperCase().includes(action)))
      .slice(0, limit);
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      createdAt: r.createdAt.toISOString(),
      previousState: r.previousState ?? null,
      newState: r.newState ?? null,
    }));
  }
}
