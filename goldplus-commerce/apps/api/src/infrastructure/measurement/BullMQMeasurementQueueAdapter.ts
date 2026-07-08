import { MeasurementEventQueue } from '../../application/ports/measurement/MeasurementEventQueue';

export class BullMQMeasurementQueueAdapter implements MeasurementEventQueue {
  async addEvent(destinationId: string, payload: any, options?: { delay?: number; priority?: number }): Promise<string> {
    // Mock queue addition
    return `job_${Date.now()}`;
  }

  async getJobStatus(jobId: string): Promise<{ status: string; progress: number } | null> {
    return { status: 'completed', progress: 100 };
  }
}
