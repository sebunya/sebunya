export interface EvidencePack {
  id: string;
  dryRunId: string;
  activationRequestId: string;
  summary: string;
  gateSummary: string;
  payloadPreviewSummary: string;
  consentSummary: string;
  canarySummary: string;
  rollbackSummary: string;
  monitoringSummary: string;
  redactedBy: string;
  createdAt: Date;
}

export interface ControlledActivationEvidencePackBuilder {
  buildEvidencePack(
    dryRunId: string,
    activationRequestId: string
  ): Promise<EvidencePack>;
  getEvidencePack(dryRunId: string): Promise<EvidencePack | null>;
}
