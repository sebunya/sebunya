import { IOutboxRepository } from '../../ports/IOutboxRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { ADMIN_ORDER_EMAIL_EVENT_TYPE } from './EnqueueAdminOrderEmailUseCase';

export type ReplayAdminOrderEmailResult =
  | { ok: true; eventId: string; requeued: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'WRONG_TYPE' | 'NOT_ELIGIBLE'; message: string };

/**
 * Operator manual replay of a failed / dead-letter admin-order-email intent.
 * Does not create a new business event, does not bypass RBAC (enforced at the
 * route), and does not print provider credentials. Requeue is idempotent —
 * replaying a delivered (no-error) or already-pending event is a no-op.
 */
export class ReplayAdminOrderEmailUseCase {
  constructor(
    private readonly outbox: IOutboxRepository,
    private readonly audit: IAuditRepository
  ) {}

  async execute(input: { eventId: string; actorId: string; reason: string }): Promise<ReplayAdminOrderEmailResult> {
    const event = await this.outbox.findById(input.eventId);
    if (!event) return { ok: false, code: 'NOT_FOUND', message: 'Outbox event not found.' };
    if (event.eventType !== ADMIN_ORDER_EMAIL_EVENT_TYPE) {
      return { ok: false, code: 'WRONG_TYPE', message: 'Event is not an admin order email.' };
    }

    const requeued = await this.outbox.requeueForReplay(event.id, new Date());
    if (!requeued) {
      return { ok: false, code: 'NOT_ELIGIBLE', message: 'Event is not in a replayable (failed) state.' };
    }

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'ADMIN_ORDER_EMAIL_REPLAYED',
      entity: 'outbox_event',
      entityId: event.id,
      newState: { reason: input.reason || null, relatedEntityId: event.relatedEntityId ?? null },
    });

    return { ok: true, eventId: event.id, requeued: true };
  }
}
