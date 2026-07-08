import { IMeasurementQueuePort } from '../../application/ports/measurement/IMeasurementQueuePort';
import { QueueService } from '../queues/QueueService';

export class BullMQMeasurementQueueAdapter implements IMeasurementQueuePort {
  async enqueuePaidSocialEvent(destinationName: string, payload: any): Promise<void> {
    const queueService = QueueService.getInstance();
    const queue = queueService.getQueue('measurement-destinations');
    if (queue) {
      await queue.add('deliver-paid-social', { destinationName, payload });
    }
  }
}
