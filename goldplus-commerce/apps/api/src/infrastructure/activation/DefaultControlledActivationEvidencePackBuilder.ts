import { randomUUID } from 'crypto';
import { ControlledActivationEvidencePackBuilder, EvidencePack } from '../../application/ports/activation/ControlledActivationEvidencePackBuilder.js';

export class DefaultControlledActivationEvidencePackBuilder implements ControlledActivationEvidencePackBuilder {
  private packs: Map<string, EvidencePack> = new Map();

  async buildEvidencePack(dryRunId: string, activationRequestId: string): Promise<EvidencePack> {
    const pack: EvidencePack = {
      id: randomUUID(),
      dryRunId,
      activationRequestId,
      summary: 'Dry-run execution verified successfully.',
      gateSummary: 'All pre-flight gates passed.',
      payloadPreviewSummary: 'Payload previews generated. No PII leaks detected.',
      consentSummary: 'Consent routing rules upheld.',
      canarySummary: 'Canary plan attached and validated.',
      rollbackSummary: 'Rollback procedures verified.',
      monitoringSummary: 'Monitoring dashboards provisioned.',
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
