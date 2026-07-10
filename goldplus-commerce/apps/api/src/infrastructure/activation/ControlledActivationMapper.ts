import { ActivationEvidenceRedactor } from '../../application/ports/activation/ActivationEvidenceRedactor.js';
import { ActivationRequest } from '../../application/ports/activation/ControlledActivationRepository.js';

export class ControlledActivationMapper {
  constructor(private readonly redactor: ActivationEvidenceRedactor) {}

  toPublicDto(request: ActivationRequest) {
    return {
      ...request,
      reason: this.redactor.redact(request.reason),
      rollbackPlanSummary: request.rollbackPlanSummary ? this.redactor.redact(request.rollbackPlanSummary) : null,
    };
  }
}
