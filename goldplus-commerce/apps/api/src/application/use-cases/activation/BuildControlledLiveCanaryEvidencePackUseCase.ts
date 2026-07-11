import { LiveCanaryEvidencePack, ControlledLiveCanaryEvidenceBuilder } from '../../ports/activation/ControlledLiveCanaryEvidenceBuilder.js';
import { ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';

export interface BuildEvidenceInput {
  canaryId: string;
}

export class BuildControlledLiveCanaryEvidencePackUseCase {
  constructor(
    private canaryRepo: ControlledLiveCanaryRepository,
    private builder: ControlledLiveCanaryEvidenceBuilder
  ) {}

  async execute(input: BuildEvidenceInput): Promise<LiveCanaryEvidencePack> {
    const canary = await this.canaryRepo.getCanary(input.canaryId);
    if (!canary) {
      throw new Error('CANARY_NOT_FOUND');
    }

    return this.builder.buildEvidencePack(canary, [], []);
  }
}
