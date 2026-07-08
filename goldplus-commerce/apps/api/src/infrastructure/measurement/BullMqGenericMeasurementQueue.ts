import { Queue } from 'bullmq';
import { IGenericMeasurementQueue, MeasurementQueueEvent } from '../../application/ports/measurement/GenericMeasurementQueue';
import type { MeasurementLogger } from '../../application/ports/measurement/MeasurementLogger';

export class BullMqGenericMeasurementQueue implements IGenericMeasurementQueue {
  private isLocalFallback = false;

  constructor(
    private readonly queue: Queue | null,
    private readonly logger: MeasurementLogger
  ) {
    if (!queue) {
      this.isLocalFallback = true;
      this.logger.warn({}, '[MeasurementEventQueue] BullMQ not configured. Using safe local fallback (dry-run).');
    }
  }

  async enqueueMeasurementEvent(event: MeasurementQueueEvent): Promise<{ queued: boolean; status: string; eventId: string }> {
    const safeLog = {
      eventId: event.eventId,
      eventName: event.eventName,
      source: event.source,
      sessionId: event.sessionId,
      customerId: event.customerId,
      dryRun: event.dryRun
    };

    if (this.isLocalFallback) {
      this.logger.info({ event: safeLog }, `[MeasurementEventQueue] (Fallback) Queued generic measurement event: ${event.eventName}`);
      return { queued: true, status: 'fallback', eventId: event.eventId };
    }

    try {
      await this.queue!.add('generic-measurement-event', event, {
        jobId: `measure-${event.source}-${event.eventId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      });
      return { queued: true, status: 'enqueued', eventId: event.eventId };
    } catch (err: any) {
      this.logger.error({ err, event: safeLog }, '[MeasurementEventQueue] Failed to enqueue generic measurement event');
      return { queued: false, status: 'error', eventId: event.eventId };
    }
  }
}
