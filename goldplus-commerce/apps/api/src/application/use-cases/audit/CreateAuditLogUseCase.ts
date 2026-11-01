import { randomUUID } from 'node:crypto';
import { auditEntityId } from '../../../domain/audit/AuditEntityId';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { AuditLogEntity } from '../../../domain/audit/AuditLogEntity';

export interface CreateAuditLogInput {
  /** UUID of the user performing the action. Null for system / webhook events. */
  actorId: string | null;
  /** Short verb. Examples: `ADMIN_LOGIN`, `DEALER_APPROVED`, `QUOTE_REPLIED`, `PAYMENT_CONFIRMED_MANUAL`. */
  action: string;
  /** The bounded-context entity touched. Examples: `dealer`, `order`, `payment`, `support_ticket`, `user`. */
  entity: string;
  /** UUID of the entity instance. */
  entityId: string;
  /** Optional state snapshot before the change. */
  previousState?: unknown;
  /** Optional state snapshot after the change. */
  newState?: unknown;
}

export type CreateAuditLogResult =
  | { ok: true; id: string }
  | { ok: false; code: 'BAD_INPUT'; message: string };

export class CreateAuditLogUseCase {
  constructor(private readonly audit: IAuditRepository) {}

  async execute(input: CreateAuditLogInput): Promise<CreateAuditLogResult> {
    const action = (input.action ?? '').trim();
    const entity = (input.entity ?? '').trim();
    const entityId = (input.entityId ?? '').trim();

    if (!action) return { ok: false, code: 'BAD_INPUT', message: 'action is required.' };
    if (!entity) return { ok: false, code: 'BAD_INPUT', message: 'entity is required.' };
    if (!entityId) return { ok: false, code: 'BAD_INPUT', message: 'entityId is required.' };
    if (action.length > 100) return { ok: false, code: 'BAD_INPUT', message: 'action is too long (max 100).' };
    if (entity.length > 50) return { ok: false, code: 'BAD_INPUT', message: 'entity is too long (max 50).' };

    const log = AuditLogEntity.record(
      randomUUID(),
      input.actorId ?? null,
      action,
      entity,
      // A singleton's name ('global', 'config') becomes a stable UUID; a real
      // UUID passes through. See domain/audit/AuditEntityId.
      auditEntityId(entity, entityId),
      input.previousState ?? null,
      input.newState ?? null,
    );
    await this.audit.save(log);
    return { ok: true, id: log.id };
  }
}

