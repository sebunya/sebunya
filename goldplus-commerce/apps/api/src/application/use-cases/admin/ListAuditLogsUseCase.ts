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
    const actorId = opts.actorId?.trim() || undefined;
    const action = opts.action?.trim() || undefined;
    // One record's history comes from the per-entity index (bounded by that
    // record's own rows, narrowed here); the feed is narrowed IN THE QUERY, so a
    // match older than the most recent page is never silently missed.
    const rows = entity && entityId
      ? (await this.audit.findByEntity(entity, entityId))
          .filter((r) => (!actorId || r.actorId === actorId) && (!action || r.action.toUpperCase().includes(action.toUpperCase())))
          .slice(0, limit)
      : await this.audit.findAll({ limit, actorId, action });
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
