import { ControlledLiveCanaryTransport, CanaryDeliveryAttempt } from '../../application/ports/activation/ControlledLiveCanaryTransport.js';

export class DefaultControlledLiveCanaryTransport implements ControlledLiveCanaryTransport {
  async sendCanary(
    canaryId: string,
    destination: string,
    payloads: any[],
    canaryCap: number
  ): Promise<CanaryDeliveryAttempt> {
    // Under strict safety rules, we block real live sends by default in this phase
    // since no verified live transport is safely pre-configured.
    return {
      id: `attempt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      canaryId,
      destination,
      status: 'NOT_CONFIGURED',
      redactedPayloadSummary: `Destination: ${destination}, Count: ${payloads.length}, Cap: ${canaryCap}`,
      redactedResponseSummary: 'provider transport integration required before real live canary send',
      attemptedAt: new Date()
    };
  }
}
