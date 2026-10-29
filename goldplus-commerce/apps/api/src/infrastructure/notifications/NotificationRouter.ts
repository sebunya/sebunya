import { INotificationProvider, NotificationDispatchPayload, NotificationDispatchResult } from '../../application/ports/INotificationProvider';
import { INotificationRouter, NotificationRoutingTarget } from '../../application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { parseAdminRecipients } from '../../domain/notifications/AdminOrderEmail';
import { paidOrderAlertText } from '../../domain/fulfilment/PaidOrderAlert';
import { IAutomationActionRepository } from '../../application/ports/IAutomationActionRepository';
import { AutomationOutcomeTrackingProvider } from '../automation/AutomationOutcomeTrackingProvider';
import { toRelatedEntityId } from '../../domain/notifications/RelatedEntityId';
import { basketReminderSendRefusal } from '../../application/use-cases/abandonment/SendBasketRemindersUseCase';

/** BASKET_REMINDERS=off stops basket reminders, the queued ones included, without a deploy. On unless switched off. */
export function basketRemindersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BASKET_REMINDERS || '').trim().toLowerCase() !== 'off';
}

export class DefaultNotificationRouter implements INotificationRouter {
  private basketReminderRecheck: ((userId: string, phoneE164: string) => Promise<boolean>) | null = null;

  /** 0210: the reminder's consent gate, read again when it is sent (Registry wires it once both exist). */
  setBasketReminderRecheck(check: (userId: string, phoneE164: string) => Promise<boolean>): void {
    this.basketReminderRecheck = check;
  }

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

    /**
     * WhatsApp ahead of SMS, for one customer message to one phone.
     *
     * WhatsApp is offered only when its provider says it can carry THIS template
     * to THIS number with THIS data (channel on, Zoho configured, template mapped
     * and keyed, transactional). Otherwise the SMS target is returned exactly as
     * before. When it is offered, the SMS target rides along as the fallback, so
     * the event still has ONE target and the customer gets ONE message.
     */
    const whatsappFirst = (sms: NotificationRoutingTarget): NotificationRoutingTarget => {
      const p = sms.payload;
      const can = this.whatsappProvider.canCarry?.(p.template, p.recipient, (p.data || {}) as Record<string, unknown>) === true;
      if (!can) return sms;
      return { channel: 'whatsapp', provider: this.whatsappProvider, payload: p, fallback: sms };
    };

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
        // WhatsApp on the same number proves control of it just as well, and
        // SMS is the fallback when WhatsApp cannot carry it.
        targets.push(whatsappFirst({
          channel: 'sms',
          provider: this.smsProvider,
          payload: {
            recipient: customerPhone,
            template: 'PHONE_VERIFICATION',
            data: payload,
            relatedEntity: 'user_phone',
            relatedEntityId,
          },
        }));
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

      /**
       * The paid-order alert (0143). Internal: it goes only to the shop's own
       * fulfilment phone(s), never to a customer. Since 2026-10-21 it carries what
       * the person preparing the order needs to act on it as it is read: the
       * items, the place, the customer's name and number, whether delivery was
       * charged, and a link (domain/fulfilment/PaidOrderAlert.ts).
       */
      case 'FULFILMENT_PAID_ORDER_ALERT': {
        const recipient = typeof payload.recipient === 'string' ? payload.recipient : '';
        if (!recipient) break;
        const orderNumber = String(payload.orderNumber ?? '');
        const total = Number(payload.totalUgx ?? 0);
        const area = String(payload.deliveryArea ?? '').trim();
        const amount = Number.isFinite(total) ? `UGX ${Math.round(total).toLocaleString('en-GB')}` : '';
        const full = Array.isArray(payload.items) && typeof payload.customerPhone === 'string'
          ? paidOrderAlertText({
              orderNumber, totalUgx: total, deliveryFeeUgx: Number(payload.deliveryFeeUgx ?? 0),
              items: (payload.items as Array<Record<string, unknown>>).map((it) => ({ name: String(it.name ?? ''), sku: String(it.sku ?? ''), quantity: Number(it.quantity ?? 1) })),
              customerName: String(payload.customerName ?? ''), customerPhone: String(payload.customerPhone ?? ''),
              deliveryArea: area, deliveryAddress: String(payload.deliveryPlace ?? ''), placeLabel: (payload.placeLabel as string | null) ?? null,
              mapUrl: (payload.mapUrl as string | null) ?? null, storeCreditUgx: Number(payload.storeCreditUgx ?? 0), orderUrl: String(payload.orderUrl ?? ''),
            })
          : null;
        // The test shows the REAL text, built from the latest paid order, marked so nobody prepares it twice.
        const message = payload.test === true
          ? (full ? `TEST - nothing new was sold. A paid order reaches you like this:\n${full}` : `GoldPlus test alert: this is how a paid order will reach you. Nothing has been sold.`)
          // Queued before 2026-10-21 (no items or phone in the event): the old one-line wording.
          : full ?? `GoldPlus: order ${orderNumber} is PAID${amount ? ` (${amount})` : ''}${area ? ` for ${area}` : ''}. Prepare it for delivery.`;
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

      // ── Customer acknowledgements and order messages ─────────────────────
      // Everything a customer receives about their own request or order. The
      // body was attached at enqueue (CustomerOutboxNotifier), so the SMS
      // adapter never has to invent one. SMS first, email as the fallback.
      //
      // SUPPORT and QUOTE belong HERE. A paid-order alert case was once
      // inserted between their labels and this block, so both fell through
      // into it, found no `recipient`, produced zero targets, and the outbox
      // marked every acknowledgement "processed" having sent nothing.
      //
      // Product questions (0208): the "we have your question" note and the answer itself. Both were enqueued from
      // 2026-10-28 and retired here as "No channel mapping": no asker ever received an answer, while staff were told
      // it had been sent (found 2026-10-29).
      case 'SUPPORT_REQUEST_RECEIVED':
      case 'QUOTE_REQUEST_RECEIVED':
      case 'DEALER_APPLICATION_RECEIVED':
      case 'FAKE_REPORT_RECEIVED':
      case 'PRODUCT_QUESTION_RECEIVED':
      case 'PRODUCT_QUESTION_ANSWERED':
      case 'CUSTOMER_ORDER_MESSAGE': {
        const customerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone : '';
        const customerEmail = typeof payload.customerEmail === 'string' ? payload.customerEmail : '';
        const template = eventType === 'CUSTOMER_ORDER_MESSAGE' && typeof payload.template === 'string'
          ? payload.template
          : eventType;
        // 0196/0199: a gift card / store credit SMS rides this type but belongs to the card (or its purchase), not to an order.
        const entity = eventType === 'CUSTOMER_ORDER_MESSAGE'
          ? (relatedEntity === 'credit_instrument' || relatedEntity === 'gift_card_purchase' ? relatedEntity : 'order')
          : relatedEntity || 'customer_request';
        const dryRun = payload.dryRunOnly === true;
        if (customerPhone) {
          const sms: NotificationRoutingTarget = {
            channel: 'sms',
            provider: honourDryRun(this.smsProvider, dryRun),
            payload: { recipient: customerPhone, template, data: payload, relatedEntity: entity, relatedEntityId },
          };
          // A dry-run-only event stays on its SMS dry run: nothing is offered to
          // a live channel for a message that must not leave the system.
          targets.push(dryRun ? sms : whatsappFirst(sms));
        }
        // 2026-10-16: the email went out only when there was NO phone, and checkout requires a phone, so no
        // customer ever received the emailed receipt the templates were written for. A customer who gave an
        // email gets it as well as the SMS/WhatsApp. Acknowledgements (support, quotes, dealers) keep one channel.
        if (customerEmail && (eventType === 'CUSTOMER_ORDER_MESSAGE' || !customerPhone)) {
          targets.push({
            channel: 'email',
            provider: honourDryRun(this.emailProvider, dryRun),
            payload: { recipient: customerEmail, template, data: payload, relatedEntity: entity, relatedEntityId },
          });
        }
        break;
      }

      // 0210: the basket reminder. Marketing, sent only on the customer's own SMS consent (the gate ran when it was
      // queued), so SMS only: never WhatsApp (transactional templates only) and never email (not what they ticked).
      // It was unrouted from 2026-10-28 (retired as "No channel mapping") until its review fixes of 2026-10-29. At
      // send time it is refused, as a final DISABLED outcome with the reason, when the switch is off, in quiet hours,
      // or past its send-by time: the outbox retries for hours, and a late reminder is dropped, never delayed.
      // The consent is read again here too: a customer who switched reminders off, changed number or sent STOP
      // after it was queued gets nothing. A read that fails is retried (still bounded by the send-by time).
      case 'BASKET_REMINDER': {
        const customerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone : '';
        if (!customerPhone) break;
        let refusal = basketReminderSendRefusal(payload, new Date(), basketRemindersEnabled());
        let recheckFailed = false;
        if (!refusal && this.basketReminderRecheck) {
          const userId = typeof payload.userId === 'string' ? payload.userId : '';
          const still = userId ? await this.basketReminderRecheck(userId, customerPhone).catch(() => { recheckFailed = true; return false; }) : false;
          if (!still && !recheckFailed) refusal = 'Not sent: basket reminders no longer cover this customer and number (switched off, number changed or STOP since it was queued).';
        }
        const provider: INotificationProvider = refusal
          ? { dispatch: async () => ({ status: 'DISABLED', providerCode: 'BASKET_REMINDER_REFUSED', providerMessage: refusal, retryable: false }) }
          : recheckFailed
            ? { dispatch: async () => ({ status: 'FAILED', providerCode: 'BASKET_REMINDER_RECHECK_FAILED', providerMessage: 'The consent could not be read just now; tried again shortly.', retryable: true }) }
            : honourDryRun(this.smsProvider, payload.dryRunOnly === true);
        targets.push({
          channel: 'sms',
          provider,
          payload: { recipient: customerPhone, template: 'BASKET_REMINDER', data: payload, relatedEntity: relatedEntity || 'cart', relatedEntityId },
        });
        break;
      }

      // Goldie (site chat), pre-rendered in the domain (ChatTranscript): the handover goes
      // to the shop's configured order inbox (same recipients as the new-order email);
      // the transcript goes only to the address the customer typed for their own copy.
      case 'GOLDIE_HANDOVER': {
        const { recipients } = parseAdminRecipients(process.env.ADMIN_ORDER_NOTIFICATION_EMAILS || process.env.OPS_ALERT_EMAIL);
        for (const recipient of recipients) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: { recipient, template: 'GOLDIE_HANDOVER', data: { subject: payload.subject, text: payload.text, html: payload.html, replyTo: payload.replyTo, replyToName: payload.replyToName }, relatedEntity: 'support_issue', relatedEntityId },
          });
        }
        break;
      }
      // Care Desk alerts (0178): to a team member's own phone or inbox, when Goldie opens an urgent task.
      case 'CARE_ALERT_SMS': {
        const recipient = typeof payload.recipient === 'string' ? payload.recipient : '';
        const message = typeof payload.message === 'string' ? payload.message : '';
        if (recipient && message) targets.push({ channel: 'sms', provider: this.smsProvider, payload: { recipient, template: 'CARE_ALERT', data: { message }, relatedEntity: 'care_task', relatedEntityId } });
        break;
      }
      case 'CARE_ALERT_EMAIL': {
        const recipient = typeof payload.recipient === 'string' ? payload.recipient : '';
        if (recipient) targets.push({ channel: 'email', provider: this.emailProvider, payload: { recipient, template: 'CARE_ALERT_EMAIL', data: { subject: payload.subject, text: payload.text, html: payload.html }, relatedEntity: 'care_task', relatedEntityId } });
        break;
      }
      case 'CARE_REPLY_EMAIL': {
        const recipient = typeof payload.recipient === 'string' ? payload.recipient.trim() : '';
        if (recipient) targets.push({ channel: 'email', provider: this.emailProvider, payload: { recipient, template: 'CARE_REPLY_EMAIL', data: { subject: payload.subject, text: payload.text, html: payload.html }, relatedEntity: 'assistant_chat', relatedEntityId } });
        break;
      }
      case 'GOLDIE_TRANSCRIPT': {
        const recipient = typeof payload.recipient === 'string' ? payload.recipient.trim() : '';
        if (recipient) {
          targets.push({
            channel: 'email',
            provider: this.emailProvider,
            payload: { recipient, template: 'GOLDIE_TRANSCRIPT', data: { subject: payload.subject, text: payload.text, html: payload.html }, relatedEntity: 'assistant_chat', relatedEntityId },
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
