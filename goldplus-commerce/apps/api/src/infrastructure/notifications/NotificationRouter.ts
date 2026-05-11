import { INotificationProvider } from '../../application/ports/INotificationProvider';
import { INotificationRouter, NotificationRoutingTarget } from '../../application/use-cases/outbox/ProcessOutboxBatchUseCase';

export class DefaultNotificationRouter implements INotificationRouter {
  constructor(
    private readonly emailProvider: INotificationProvider,
    private readonly whatsappProvider: INotificationProvider,
    private readonly smsProvider: INotificationProvider
  ) {}

  async route(eventType: string, payload: Record<string, unknown>): Promise<NotificationRoutingTarget[]> {
    const targets: NotificationRoutingTarget[] = [];
    const opsEmail = (process.env.OPS_ALERT_EMAIL || '').trim();
    const opsWhatsapp = (process.env.OPS_ALERT_WHATSAPP || '').trim();

    const relatedEntity = String(payload.relatedEntity || '');
    const relatedEntityId = String(payload.relatedEntityId || payload.id || '');

    switch (eventType) {
      case 'PAYMENT_SUCCESS':
      case 'PAYMENT_FAILED':
        if (opsEmail) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: {
              recipient: opsEmail,
              template: eventType,
              data: { eventType, paymentId: relatedEntityId },
              relatedEntity: 'payment',
              relatedEntityId,
            },
          });
        }
        if (opsWhatsapp) {
          targets.push({
            channel: 'whatsapp',
            provider: this.whatsappProvider,
            payload: {
              recipient: opsWhatsapp,
              template: eventType,
              data: { eventType, paymentId: relatedEntityId },
              relatedEntity: 'payment',
              relatedEntityId,
            },
          });
        }
        break;

      case 'DEALER_APPLICATION_SUBMITTED':
        if (opsEmail) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: {
              recipient: opsEmail,
              template: 'DEALER_APPLICATION',
              data: { applicationId: relatedEntityId },
              relatedEntity: 'dealer_application',
              relatedEntityId,
            },
          });
        }
        break;

      case 'QUOTE_REQUESTED':
        if (opsEmail) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: {
              recipient: opsEmail,
              template: 'NEW_QUOTE_REQUEST',
              data: { quoteId: relatedEntityId },
              relatedEntity: 'quote_request',
              relatedEntityId,
            },
          });
        }
        break;

      case 'FAKE_PRODUCT_REPORTED':
        if (opsEmail) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: {
              recipient: opsEmail,
              template: 'FAKE_REPORT_ALERT',
              data: { reportId: relatedEntityId },
              relatedEntity: 'fake_product_report',
              relatedEntityId,
            },
          });
        }
        break;

      default:
        // Explicitly unhandled event type maps to empty array, which processor handles
        break;
    }

    return targets;
  }
}
