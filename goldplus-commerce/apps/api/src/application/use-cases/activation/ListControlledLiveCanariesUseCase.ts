import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';

export class ListControlledLiveCanariesUseCase {
  constructor(private canaryRepo: ControlledLiveCanaryRepository) {}

  async execute(activationRequestId: string): Promise<ControlledLiveCanary[]> {
    return this.canaryRepo.getCanariesForRequest(activationRequestId);
  }
}
