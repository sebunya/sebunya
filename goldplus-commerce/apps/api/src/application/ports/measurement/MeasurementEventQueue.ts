import { Job } from 'bullmq';

export interface MeasurementEventQueue {
  addEvent(destinationId: string, payload: any, options?: { delay?: number; priority?: number }): Promise<string>;
  getJobStatus(jobId: string): Promise<{ status: string; progress: number } | null>;
}
