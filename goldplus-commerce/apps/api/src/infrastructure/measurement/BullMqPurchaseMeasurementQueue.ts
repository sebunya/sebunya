import { Queue } from 'bullmq';
import { IPurchaseMeasurementQueue, PurchaseMeasurementJobData, PurchaseMeasurementQueueStatus } from '../../application/ports/measurement/PurchaseMeasurementQueue';
import type { MeasurementLogger } from '../../application/ports/measurement/MeasurementLogger';

export class BullMqPurchaseMeasurementQueue implements IPurchaseMeasurementQueue {
  private isLocalFallback = false;

  constructor(
    private readonly queue: Queue | null,
    private readonly logger: MeasurementLogger
  ) {
    if (!queue) {
      this.isLocalFallback = true;
      this.logger.warn({}, '[PurchaseMeasurementQueue] BullMQ not configured. Using safe local fallback (dry-run).');
    }
  }

  async enqueuePurchaseMeasurement(data: PurchaseMeasurementJobData): Promise<boolean> {
    if (this.isLocalFallback) {
      this.logger.info({ data }, '[PurchaseMeasurementQueue] (Fallback) Queued purchase measurement event');
      return true;
    }

    try {
      await this.queue!.add('route-purchase-event', data, {
        jobId: `purchase-${data.eventId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      });
      return true;
    } catch (err: any) {
      this.logger.error({ err, data }, '[PurchaseMeasurementQueue] Failed to enqueue purchase measurement event');
      return false;
    }
  }

  async enqueuePurchaseRetry(data: PurchaseMeasurementJobData): Promise<boolean> {
    if (this.isLocalFallback) {
      this.logger.info({ data }, '[PurchaseMeasurementQueue] (Fallback) Queued purchase retry event');
      return true;
    }

    try {
      await this.queue!.add('retry-purchase-event', data, {
        jobId: `retry-purchase-${data.eventId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      });
      return true;
    } catch (err: any) {
      this.logger.error({ err, data }, '[PurchaseMeasurementQueue] Failed to enqueue purchase retry event');
      return false;
    }
  }

  async getQueueStatus(): Promise<PurchaseMeasurementQueueStatus> {
    if (this.isLocalFallback) {
      return { isConfigured: false, waitingCount: 0, activeCount: 0, failedCount: 0 };
    }

    try {
      const counts = await this.queue!.getJobCounts('waiting', 'active', 'failed');
      return {
        isConfigured: true,
        waitingCount: counts.waiting,
        activeCount: counts.active,
        failedCount: counts.failed
      };
    } catch {
      return { isConfigured: true, waitingCount: -1, activeCount: -1, failedCount: -1 };
    }
  }
}
