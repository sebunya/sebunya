import { PaidSocialDeliveryRepository } from '../../ports/measurement/PaidSocialDeliveryRepository';

export class GetPaidSocialDeliveryHealthUseCase {
  constructor(private readonly deliveryRepo: PaidSocialDeliveryRepository) {}

  async execute() {
    return this.deliveryRepo.getDeliveryHealthSummary();
  }
}
