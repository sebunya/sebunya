import { PaidSocialDeliveryRepository } from '../../ports/measurement/PaidSocialDeliveryRepository';

export class BlockMeasurementEventUseCase {
  constructor(private readonly deliveryRepo: PaidSocialDeliveryRepository) {}

  async execute(destinationId: string, eventId: string, reason: string): Promise<void> {
    await this.deliveryRepo.recordDeliveryAttempt(destinationId, eventId, 'BLOCKED', reason);
  }
}
