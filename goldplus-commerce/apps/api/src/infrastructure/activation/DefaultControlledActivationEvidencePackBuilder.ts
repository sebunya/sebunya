import { randomUUID } from 'crypto';
import { ControlledActivationEvidencePackBuilder, EvidencePack } from '../../application/ports/activation/ControlledActivationEvidencePackBuilder.js';

const NOT_VERIFIED = 'Not verified: evidence collection is not built yet.';

/**
 * Evidence collection is NOT BUILT. Every summary used to be a fixed claim —
 * "No PII leaks detected", "Rollback procedures verified", "Monitoring dashboards
 * provisioned" — that no code computed. Each now says it was not verified.
 *
 * KNOWN LIMITATION (2026-09-24): packs live in THIS process's memory (two API
 * containers; lost on restart), as the canary planner documents. Persistence is
 * deferred with the rest of the controlled-activation clients.
 */
export class DefaultControlledActivationEvidencePackBuilder implements ControlledActivationEvidencePackBuilder {
  private packs: Map<string, EvidencePack> = new Map();

  async buildEvidencePack(dryRunId: string, activationRequestId: string): Promise<EvidencePack> {
    const pack: EvidencePack = {
      id: randomUUID(),
      dryRunId,
      activationRequestId,
      summary: NOT_VERIFIED,
      gateSummary: NOT_VERIFIED,
      payloadPreviewSummary: NOT_VERIFIED,
      consentSummary: NOT_VERIFIED,
      canarySummary: NOT_VERIFIED,
      rollbackSummary: NOT_VERIFIED,
      monitoringSummary: NOT_VERIFIED,
      redactedBy: 'SYSTEM',
      createdAt: new Date()
    };

    this.packs.set(dryRunId, pack);
    return pack;
  }

  async getEvidencePack(dryRunId: string): Promise<EvidencePack | null> {
    return this.packs.get(dryRunId) || null;
  }
}
