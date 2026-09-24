import { randomUUID } from 'crypto';
import { ControlledActivationPayloadPreviewer, DestinationPayloadPreview } from '../../application/ports/activation/ControlledActivationPayloadPreviewer.js';

/**
 * Payload preview generation is NOT BUILT.
 *
 * This used to return one fixed Meta PURCHASE with consent 'GRANTED' and a value
 * of 50,000 for every dry run — an invented payload presented as a checked one,
 * which let a dry run PASS on evidence nobody produced. It now returns one honest
 * BLOCKED preview saying so, so a dry run cannot pass until real previews exist.
 *
 * KNOWN LIMITATION (2026-09-24): like the canary planner, results live in THIS
 * process's memory. Production runs two API containers, so a preview made on one
 * is absent on the other (MarkActivationReadyForLiveReview then refuses, closed)
 * and gone after a restart. Persistence is deferred with the rest of the
 * controlled-activation clients (trigger: the first measurement destination goes live).
 */
export class DefaultControlledActivationPayloadPreviewer implements ControlledActivationPayloadPreviewer {
  private previews: Map<string, DestinationPayloadPreview[]> = new Map();

  async generatePreviews(dryRunId: string, activationRequestId: string): Promise<DestinationPayloadPreview[]> {
    void activationRequestId;
    const generated: DestinationPayloadPreview[] = [
      {
        id: randomUUID(),
        dryRunId,
        destination: 'NONE',
        eventType: 'NONE',
        consentStatus: 'NOT_EVALUATED',
        routingDecision: 'NOT_EVALUATED',
        status: 'BLOCKED',
        redactedPayload: null,
        blockedReason: 'Not verified: destination payload preview generation is not built yet.',
        createdAt: new Date()
      }
    ];

    this.previews.set(dryRunId, generated);
    return generated;
  }

  async getPreviewsForDryRun(dryRunId: string): Promise<DestinationPayloadPreview[]> {
    return this.previews.get(dryRunId) || [];
  }
}
