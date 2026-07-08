import { PaidSocialDeliveryRepository } from '../../ports/measurement/PaidSocialDeliveryRepository';

export class RetryPaidSocialDeliveryUseCase {
  constructor(private readonly deliveryRepo: PaidSocialDeliveryRepository) {}

  async execute(eventId: string) {
    await this.deliveryRepo.retryDelivery(eventId);
    return { success: true, eventId };
  }
}
