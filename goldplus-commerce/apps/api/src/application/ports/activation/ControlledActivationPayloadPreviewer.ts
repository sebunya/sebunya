export type DestinationPreviewStatus =
  | 'PREVIEW_READY'
  | 'NOT_CONFIGURED'
  | 'DRY_RUN'
  | 'CONSENT_BLOCKED'
  | 'BLOCKED'
  | 'INVALID';

export interface DestinationPayloadPreview {
  id: string;
  dryRunId: string;
  destination: string;
  eventType: string;
  consentStatus: string;
  routingDecision: string;
  status: DestinationPreviewStatus;
  redactedPayload: any | null;
  blockedReason: string | null;
  createdAt: Date;
}

export interface ControlledActivationPayloadPreviewer {
  generatePreviews(dryRunId: string, activationRequestId: string): Promise<DestinationPayloadPreview[]>;
  getPreviewsForDryRun(dryRunId: string): Promise<DestinationPayloadPreview[]>;
}
