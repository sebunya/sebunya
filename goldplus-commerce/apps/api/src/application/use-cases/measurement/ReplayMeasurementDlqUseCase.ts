import type { DlqRepository } from '../../ports/measurement/DlqRepository';
import type { MeasurementAdminRepository } from '../../ports/measurement/MeasurementAdminRepository';
import type { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { IAuditRepository } from '../../ports/IAuditRepository';

export class ReplayMeasurementDlqUseCase {
  constructor(
    private readonly dlqRepo: DlqRepository,
    private readonly adminRepo: MeasurementAdminRepository,
    private readonly logger: MeasurementLogger,
    private readonly auditRepo: IAuditRepository,
  ) {}

  async execute(id: string, adminUserId: string) {
    const dlqEntry = await this.dlqRepo.findById(id);

    if (!dlqEntry) {
      throw new Error('NOT_FOUND');
    }

    if (dlqEntry.isResolved) {
      throw new Error('ALREADY_RESOLVED');
    }

    // Re-enqueue the payload into the outbox
    await this.adminRepo.enqueueTelemetryDispatch(dlqEntry.payload, dlqEntry.eventId);

    // Mark DLQ entry resolved
    await this.dlqRepo.markResolved(id, 'Manual replay via admin');

    this.logger.info({ dlqId: id, eventId: dlqEntry.eventId }, '[AdminMeasurement] DLQ entry replayed');

    // Create Audit Log
    const createAuditLog = new CreateAuditLogUseCase(this.auditRepo);
    await createAuditLog.execute({
      action: 'REPLAY_DLQ_EVENT',
      entityId: id,
      entity: 'MEASUREMENT_DLQ',
      actorId: adminUserId,
    });

    return { message: 'DLQ entry re-enqueued for dispatch' };
  }
}
