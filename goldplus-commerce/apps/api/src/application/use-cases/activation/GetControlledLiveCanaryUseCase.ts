import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';

export class GetControlledLiveCanaryUseCase {
  constructor(private canaryRepo: ControlledLiveCanaryRepository) {}

  async execute(canaryId: string): Promise<ControlledLiveCanary> {
    const canary = await this.canaryRepo.getCanary(canaryId);
    if (!canary) {
      throw new Error('CANARY_NOT_FOUND');
    }
    return canary;
  }
}
