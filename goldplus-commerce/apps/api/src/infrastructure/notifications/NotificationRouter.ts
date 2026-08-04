import { INotificationProvider } from '../../application/ports/INotificationProvider';
import { INotificationRouter, NotificationRoutingTarget } from '../../application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { parseAdminRecipients } from '../../domain/notifications/AdminOrderEmail';
import { IAutomationActionRepository } from '../../application/ports/IAutomationActionRepository';
import { AutomationOutcomeTrackingProvider } from '../automation/AutomationOutcomeTrackingProvider';

export class DefaultNotificationRouter implements INotificationRouter {
  constructor(
    private readonly emailProvider: INotificationProvider,
    private readonly whatsappProvider: INotificationProvider,
    private readonly smsProvider: INotificationProvider,
    private readonly automationOutcomes?: IAutomationActionRepository
  ) {}

  async route(eventType: string, payload: Record<string, unknown>): Promise<NotificationRoutingTarget[]> {
    const targets: NotificationRoutingTarget[] = [];
    const opsEmail = (process.env.OPS_ALERT_EMAIL || '').trim();
    const opsWhatsapp = (process.env.OPS_ALERT_WHATSAPP || '').trim();

    const relatedEntity = String(payload.relatedEntity || '');
    const relatedEntityId = String(payload.relatedEntityId || payload.id || '');

    switch (eventType) {
      case 'AUTOMATION_ACTION_REQUESTED': {
        if (!this.automationOutcomes) break;
        const actionExecutionId = String(payload.actionExecutionId || '');
        const actionFamily = String(payload.actionFamily || '');
        const config = payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config)
          ? payload.config as Record<string, unknown>
          : {};
        const recipient = typeof config.recipient === 'string' ? config.recipient : '';
        const template = typeof config.template === 'string' ? config.template : '';
        const delegate = actionFamily === 'EMAIL'
          ? this.emailProvider
          : actionFamily === 'WHATSAPP_TEMPLATE'
            ? this.whatsappProvider
            : null;
        if (!actionExecutionId || !delegate) break;
        targets.push({
          channel: actionFamily === 'EMAIL' ? 'email' : 'whatsapp',
          provider: new AutomationOutcomeTrackingProvider(
            delegate,
            this.automationOutcomes,
            actionExecutionId,
            payload.noSendGuarantee === true,
            payload.dryRunOnly === true ? 'DRY_RUN' : 'DISABLED'
          ),
          payload: {
            recipient,
            template,
            data: config,
            relatedEntity: 'automation_action',
            relatedEntityId: actionExecutionId,
          },
        });
        break;
      }

      case 'ADMIN_ORDER_EMAIL': {
        // Secure, configured admin recipients only (never hard-coded). One
        // pre-rendered email per recipient; missing config yields no target and
        // the processor records it as unroutable (MISSING_CONFIG at the surface).
        const { recipients } = parseAdminRecipients(
          process.env.ADMIN_ORDER_NOTIFICATION_EMAILS || process.env.OPS_ALERT_EMAIL
        );
        for (const recipient of recipients) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: {
              recipient,
              template: 'ADMIN_ORDER_EMAIL',
              data: {
                subject: payload.subject,
                text: payload.text,
                html: payload.html,
                orderNumber: payload.orderNumber,
                preparationState: payload.preparationState,
              },
              relatedEntity: 'order',
              relatedEntityId,
            },
          });
        }
        break;
      }

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

      // ── Customer loyalty messaging (loyalty brief PART M) ────────────────
      // Transactional, consent-gated at enqueue time. Channel order for this
      // market: SMS ahead of email (WhatsApp API is a deferred channel).
      case 'LOYALTY_EXPIRY_WARNING':
      case 'LOYALTY_POINTS_EARNED':
      case 'LOYALTY_REDEMPTION_CONFIRMED':
      case 'LOYALTY_REDEMPTION_REVERSED':
      case 'LOYALTY_TIER_CHANGED': {
        const customerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone : '';
        const customerEmail = typeof payload.customerEmail === 'string' ? payload.customerEmail : '';
        if (customerPhone) {
          targets.push({
            channel: 'sms',
            provider: this.smsProvider,
            payload: {
              recipient: customerPhone,
              template: eventType,
              data: payload,
              relatedEntity: 'loyalty',
              relatedEntityId,
            },
          });
        } else if (customerEmail) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: {
              recipient: customerEmail,
              template: eventType,
              data: payload,
              relatedEntity: 'loyalty',
              relatedEntityId,
            },
          });
        }
        break;
      }

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
