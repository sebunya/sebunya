import { PaidSocialDestinationRepository } from '../../ports/measurement/PaidSocialDestinationRepository';

export class ListPaidSocialDestinationsUseCase {
  constructor(private readonly destinationRepo: PaidSocialDestinationRepository) {}

  async execute() {
    return this.destinationRepo.getActiveDestinations();
  }
}
