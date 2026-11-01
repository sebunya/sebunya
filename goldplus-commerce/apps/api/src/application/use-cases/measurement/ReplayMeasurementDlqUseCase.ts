import type { DlqRepository } from '../../ports/measurement/DlqRepository';
import type { MeasurementAdminRepository } from '../../ports/measurement/MeasurementAdminRepository';
import type { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';

export class ReplayMeasurementDlqUseCase {
  constructor(
    private readonly dlqRepo: DlqRepository,
    private readonly adminRepo: MeasurementAdminRepository,
    private readonly logger: MeasurementLogger,
  ) {}

  /** The route writes the one audit row; its failure never fails a replay already enqueued. */
  async execute(id: string, _adminUserId: string) {
    const dlqEntry = await this.dlqRepo.findById(id);

    if (!dlqEntry) {
      throw new Error('NOT_FOUND');
    }

    if (dlqEntry.isResolved) {
      throw new Error('ALREADY_RESOLVED');
    }

    // Re-enqueue the payload into the outbox, keyed on THIS entry: a second
    // replay of it (double click, two operators) cannot enqueue it twice.
    await this.adminRepo.enqueueTelemetryDispatch(dlqEntry.payload, dlqEntry.eventId, id);

    // Mark DLQ entry resolved
    await this.dlqRepo.markResolved(id, 'Manual replay via admin');

    this.logger.info({ dlqId: id, eventId: dlqEntry.eventId }, '[AdminMeasurement] DLQ entry replayed');

    return { message: 'DLQ entry re-enqueued for dispatch' };
  }
}
