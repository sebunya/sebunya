import { MeasurementEventQueue } from '../../ports/measurement/MeasurementEventQueue';

export class DeliverPaidSocialEventUseCase {
  constructor(
    private readonly queue: MeasurementEventQueue
  ) {}

  async execute(destinationId: string, payload: any): Promise<{ success: boolean; jobId?: string }> {
    try {
      const jobId = await this.queue.addEvent(destinationId, payload);
      return { success: true, jobId };
    } catch (e) {
      return { success: false };
    }
  }
}
