import { INotificationProvider, NotificationDispatchPayload, NotificationDispatchResult } from '../../application/ports/INotificationProvider';
import { INotificationRouter, NotificationRoutingTarget } from '../../application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { parseAdminRecipients } from '../../domain/notifications/AdminOrderEmail';
import { IAutomationActionRepository } from '../../application/ports/IAutomationActionRepository';
import { AutomationOutcomeTrackingProvider } from '../automation/AutomationOutcomeTrackingProvider';
import { toRelatedEntityId } from '../../domain/notifications/RelatedEntityId';

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
    // Canonical absence is null, never ''. See domain/notifications/RelatedEntityId.
    const relatedEntityId = toRelatedEntityId(payload.relatedEntityId ?? payload.id);

    /**
     * Honours `dryRunOnly` for customer messages.
     *
     * The flag was decorative: the customer branch never consulted it and the
     * processor never consulted it either, so an event written with
     * `dry_run_only = true` still sent a REAL SMS to a REAL customer — proven
     * on 2026-09-20, when a payment-success SMS went out while the switch that
     * is supposed to gate customer messaging was unset. A flag that does not
     * govern anything is worse than no flag: someone reads it and believes it.
     */
    const honourDryRun = (provider: INotificationProvider, dryRun: boolean): INotificationProvider =>
      dryRun
        ? {
            dispatch: async (payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> => ({
              status: 'DRY_RUN',
              providerCode: 'DRY_RUN',
              providerMessage: `Customer messaging is in dry run: the ${payload.template} message was prepared and not sent.`,
            }),
          }
        : provider;

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

      /**
       * Phone verification (security). SMS only.
       *
       * Deliberately NOT folded into the loyalty case below, even though the
       * routing is identical. The template it emits is what governance
       * classifies from, and PHONE_VERIFICATION is TRANSACTIONAL while the
       * loyalty templates are MARKETING. Sharing the case would mean sharing
       * the template, which is how the OTP ended up requiring marketing consent
       * in the first place.
       *
       * No email fallback: a code sent to prove control of a PHONE has no
       * meaning delivered to an address.
       */
      case 'PHONE_VERIFICATION_REQUESTED': {
        const customerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone : '';
        if (!customerPhone) break;
        targets.push({
          channel: 'sms',
          provider: this.smsProvider,
          payload: {
            recipient: customerPhone,
            template: 'PHONE_VERIFICATION',
            data: payload,
            relatedEntity: 'user_phone',
            relatedEntityId,
          },
        });
        break;
      }

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

      // ── Customer acknowledgements and order messages ─────────────────────
      // Everything a customer receives about their own request or order. The
      // body was attached at enqueue (CustomerOutboxNotifier), so the SMS
      // adapter never has to invent one. SMS first, email as the fallback.
      case 'SUPPORT_REQUEST_RECEIVED':
      case 'QUOTE_REQUEST_RECEIVED':
      /**
       * The paid-order alert (0143). Internal: it goes to the shop's own
       * fulfilment phone, never to a customer, and carries no customer name or
       * address — just what is needed to go and pick the order up.
       */
      case 'FULFILMENT_PAID_ORDER_ALERT': {
        const recipient = typeof payload.recipient === 'string' ? payload.recipient : '';
        if (!recipient) break;
        const orderNumber = String(payload.orderNumber ?? '');
        const total = Number(payload.totalUgx ?? 0);
        const area = String(payload.deliveryArea ?? '').trim();
        const amount = Number.isFinite(total) ? `UGX ${Math.round(total).toLocaleString('en-GB')}` : '';
        const message = payload.test === true
          ? `GoldPlus test alert: this is how a paid order will reach you. Nothing has been sold.`
          : `GoldPlus: order ${orderNumber} is PAID${amount ? ` (${amount})` : ''}${area ? ` for ${area}` : ''}. Prepare it for delivery.`;
        targets.push({
          channel: 'sms',
          provider: this.smsProvider,
          payload: {
            recipient,
            template: 'FULFILMENT_PAID_ORDER_ALERT',
            data: { ...payload, message },
            relatedEntity: 'order',
            relatedEntityId,
          },
        });
        break;
      }

      case 'DEALER_APPLICATION_RECEIVED':
      case 'FAKE_REPORT_RECEIVED':
      case 'CUSTOMER_ORDER_MESSAGE': {
        const customerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone : '';
        const customerEmail = typeof payload.customerEmail === 'string' ? payload.customerEmail : '';
        const template = eventType === 'CUSTOMER_ORDER_MESSAGE' && typeof payload.template === 'string'
          ? payload.template
          : eventType;
        const entity = eventType === 'CUSTOMER_ORDER_MESSAGE' ? 'order' : relatedEntity || 'customer_request';
        const dryRun = payload.dryRunOnly === true;
        if (customerPhone) {
          targets.push({
            channel: 'sms',
            provider: honourDryRun(this.smsProvider, dryRun),
            payload: { recipient: customerPhone, template, data: payload, relatedEntity: entity, relatedEntityId },
          });
        } else if (customerEmail) {
          targets.push({
            channel: 'email',
            provider: honourDryRun(this.emailProvider, dryRun),
            payload: { recipient: customerEmail, template, data: payload, relatedEntity: entity, relatedEntityId },
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
