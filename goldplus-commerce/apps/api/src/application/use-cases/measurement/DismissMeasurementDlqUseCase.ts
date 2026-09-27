import type { DlqRepository } from '../../ports/measurement/DlqRepository';
import type { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

/**
 * Prefix on telemetry_dlq.resolved_note that marks a row as DISMISSED rather
 * than replayed. The table has one resolution flag (is_resolved) and a free
 * note; replay writes "Manual replay via admin", dismiss writes this prefix
 * plus the operator's reason, so the two stay distinguishable without a
 * migration.
 */
export const DLQ_DISMISSED_NOTE_PREFIX = 'DISMISSED: ';
export const DLQ_DISMISS_REASON_MIN = 3;
export const DLQ_DISMISS_REASON_MAX = 500;

/** Resolves a dead-lettered dispatch WITHOUT re-sending it. A reason is required. */
export class DismissMeasurementDlqUseCase {
  constructor(
    private readonly dlqRepo: DlqRepository,
    private readonly logger: MeasurementLogger,
    private readonly auditRepo: IAuditRepository,
  ) {}

  async execute(id: string, reason: unknown, adminUserId: string) {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < DLQ_DISMISS_REASON_MIN || trimmed.length > DLQ_DISMISS_REASON_MAX) {
      throw new Error('INVALID_REASON');
    }

    const entry = await this.dlqRepo.findById(id);
    if (!entry) throw new Error('NOT_FOUND');
    if (entry.isResolved) throw new Error('ALREADY_RESOLVED');

    const changed = await this.dlqRepo.markDismissed(id, `${DLQ_DISMISSED_NOTE_PREFIX}${trimmed}`);
    // Another operator replayed or dismissed it between the read and the write.
    if (!changed) throw new Error('ALREADY_RESOLVED');

    this.logger.info({ dlqId: id, eventId: entry.eventId }, '[AdminMeasurement] DLQ entry dismissed');

    await new CreateAuditLogUseCase(this.auditRepo).execute({
      action: 'DISMISS_DLQ_EVENT',
      entityId: id,
      entity: 'MEASUREMENT_DLQ',
      actorId: adminUserId,
      newState: { reason: trimmed },
    });

    return { message: 'DLQ entry dismissed' };
  }
}
