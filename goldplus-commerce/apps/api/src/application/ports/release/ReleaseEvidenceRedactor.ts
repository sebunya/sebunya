export interface IReleaseEvidenceRedactor {
  redactEvidence(evidence: Record<string, any>): Record<string, any>;
  redactCommandOutput(output: string): string;
  redactMetadata(metadata: Record<string, any>): Record<string, any>;
}
