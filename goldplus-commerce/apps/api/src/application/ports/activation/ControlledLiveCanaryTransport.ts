export type LiveCanaryDeliveryStatus =
  | 'NOT_SENT'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'THROTTLED'
  | 'CONSENT_BLOCKED'
  | 'NOT_CONFIGURED'
  | 'FAILED';

export interface CanaryDeliveryAttempt {
  id: string;
  canaryId: string;
  destination: string;
  status: LiveCanaryDeliveryStatus;
  redactedPayloadSummary: string;
  redactedResponseSummary: string;
  attemptedAt: Date;
}

export interface ControlledLiveCanaryTransport {
  sendCanary(
    canaryId: string,
    destination: string,
    payloads: any[],
    canaryCap: number
  ): Promise<CanaryDeliveryAttempt>;
}
