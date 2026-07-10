import { DestinationPayloadPreview, ControlledActivationPayloadPreviewer } from '../../ports/activation/ControlledActivationPayloadPreviewer.js';

export class GenerateDestinationPayloadPreviewsUseCase {
  constructor(private previewer: ControlledActivationPayloadPreviewer) {}

  async execute(dryRunId: string, activationRequestId: string): Promise<DestinationPayloadPreview[]> {
    return this.previewer.generatePreviews(dryRunId, activationRequestId);
  }
}
