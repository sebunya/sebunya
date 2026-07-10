import { randomUUID } from 'crypto';
import { ControlledActivationPayloadPreviewer, DestinationPayloadPreview } from '../../application/ports/activation/ControlledActivationPayloadPreviewer.js';

export class DefaultControlledActivationPayloadPreviewer implements ControlledActivationPayloadPreviewer {
  private previews: Map<string, DestinationPayloadPreview[]> = new Map();

  async generatePreviews(dryRunId: string, activationRequestId: string): Promise<DestinationPayloadPreview[]> {
    // Generate dummy payload previews for dry-run
    const generated: DestinationPayloadPreview[] = [
      {
        id: randomUUID(),
        dryRunId,
        destination: 'PAID_SOCIAL_META',
        eventType: 'PURCHASE',
        consentStatus: 'GRANTED',
        routingDecision: 'ALLOWED',
        status: 'PREVIEW_READY',
        redactedPayload: JSON.stringify({
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          user_data: {
            em: '[REDACTED_EMAIL_HASH]',
            ph: '[REDACTED_PHONE_HASH]',
            client_ip_address: '[REDACTED_IP]'
          },
          custom_data: {
            currency: 'UGX',
            value: 50000
          }
        }),
        blockedReason: null,
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
