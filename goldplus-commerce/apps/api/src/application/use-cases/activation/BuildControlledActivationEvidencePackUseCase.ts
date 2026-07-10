import { EvidencePack, ControlledActivationEvidencePackBuilder } from '../../ports/activation/ControlledActivationEvidencePackBuilder.js';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository.js';

export class BuildControlledActivationEvidencePackUseCase {
  constructor(
    private evidencePackBuilder: ControlledActivationEvidencePackBuilder,
    private dryRunRepo: ControlledActivationDryRunRepository
  ) {}

  async execute(dryRunId: string, activationRequestId: string): Promise<EvidencePack> {
    const pack = await this.evidencePackBuilder.buildEvidencePack(dryRunId, activationRequestId);
    await this.dryRunRepo.updateDryRun(dryRunId, { redactedEvidenceRef: pack.id });
    return pack;
  }
}
