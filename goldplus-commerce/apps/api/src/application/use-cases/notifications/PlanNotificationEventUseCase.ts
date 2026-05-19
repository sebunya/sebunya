import { NotificationEventRegistry } from './NotificationEventRegistry';
import { NotificationTruthfulnessPolicy } from './NotificationTruthfulnessPolicy';
import { NotificationIdempotency } from './NotificationIdempotency';
import { NotificationChannelEligibility } from './NotificationChannelEligibility';

export interface PlanNotificationEventInput {
  order: {
    id: string;
    orderNumber: string;
    customerEmail?: string;
    customerPhone?: string;
  };
  eventType: string;
  paymentStatus: string;
  orderStatus: string;
  fulfilmentStatus?: string;
  statusVersion: string | number;
  hasRefundOrReversal?: boolean;
}

export interface ChannelPreview {
  channel: string;
  idempotencyKey: string;
}

export interface PlanNotificationEventResult {
  eligible: boolean;
  ineligibleReason?: string;
  selectedTemplate: string | null;
  eligibleChannels: string[];
  blockedChannels: { channel: string; reason: string }[];
  deferredChannels: string[];
  idempotencyKeyPreview: ChannelPreview[];
  truthfulnessCheck: { isTruthful: boolean; reason?: string };
  requiredContactFields: string[];
  previewOnly: boolean;
  dryRunOnly: boolean;
  productionActivationStatus: 'active' | 'inactive' | 'deferred' | null;
  noSendGuarantee: boolean;
}

export class PlanNotificationEventUseCase {
  public async execute(input: PlanNotificationEventInput): Promise<PlanNotificationEventResult> {
    const rule = NotificationEventRegistry.getRule(input.eventType);

    if (!rule) {
      return {
        eligible: false,
        ineligibleReason: `Event type '${input.eventType}' is not registered in the notification event registry.`,
        selectedTemplate: null,
        eligibleChannels: [],
        blockedChannels: [],
        deferredChannels: [],
        idempotencyKeyPreview: [],
        truthfulnessCheck: { isTruthful: false, reason: 'Unregistered event type' },
        requiredContactFields: [],
        previewOnly: true,
        dryRunOnly: true,
        productionActivationStatus: null,
        noSendGuarantee: true,
      };
    }

    // Evaluate truthfulness rules
    const truthfulnessCheck = NotificationTruthfulnessPolicy.evaluate({
      eventType: input.eventType,
      paymentStatus: input.paymentStatus,
      orderStatus: input.orderStatus,
      hasRefundOrReversal: input.hasRefundOrReversal,
    });

    if (!truthfulnessCheck.isTruthful) {
      return {
        eligible: false,
        ineligibleReason: truthfulnessCheck.reason || 'Failed truthfulness checks.',
        selectedTemplate: rule.templateName,
        eligibleChannels: [],
        blockedChannels: [],
        deferredChannels: [],
        idempotencyKeyPreview: [],
        truthfulnessCheck,
        requiredContactFields: rule.requiredContactFields,
        previewOnly: true,
        dryRunOnly: true,
        productionActivationStatus: rule.productionActivationStatus,
        noSendGuarantee: true,
      };
    }

    const eligibleChannels: string[] = [];
    const blockedChannels: { channel: string; reason: string }[] = [];
    const deferredChannels: string[] = [];
    const idempotencyKeyPreview: ChannelPreview[] = [];

    // Evaluate eligibility per channel declared in rule
    const allDeclaredChannels = [
      ...rule.eligibleChannels,
      ...rule.deferredChannels,
      ...rule.blockedByDefaultChannels,
    ];

    // Deduplicate channels
    const uniqueChannels = Array.from(new Set(allDeclaredChannels));

    for (const channel of uniqueChannels) {
      // 1. WhatsApp API deferred explicitly check
      if (channel === 'whatsapp_api_deferred') {
        deferredChannels.push(channel);
        continue;
      }

      // 2. Blocked by default check
      if (rule.blockedByDefaultChannels.includes(channel)) {
        blockedChannels.push({
          channel,
          reason: 'Channel is blocked by default for this event type.',
        });
        continue;
      }

      // 3. Contact information check
      const contactInfo = {
        email: input.order.customerEmail,
        phone: input.order.customerPhone,
      };

      const eligibility = NotificationChannelEligibility.evaluate(channel, contactInfo);

      if (eligibility.isDeferred) {
        deferredChannels.push(channel);
      } else if (!eligibility.isEligible) {
        blockedChannels.push({
          channel,
          reason: eligibility.reason || 'Channel eligibility check failed.',
        });
      } else {
        eligibleChannels.push(channel);
        // Build preview idempotency key for this channel
        const idempotencyKey = NotificationIdempotency.buildKey({
          orderId: input.order.id,
          eventType: input.eventType,
          channel,
          templateName: rule.templateName,
          paymentStatus: input.paymentStatus,
          orderStatus: input.orderStatus,
          statusVersion: input.statusVersion,
        });
        idempotencyKeyPreview.push({ channel, idempotencyKey });
      }
    }

    return {
      eligible: eligibleChannels.length > 0,
      ineligibleReason: eligibleChannels.length === 0 ? 'No eligible channels resolved for dispatch.' : undefined,
      selectedTemplate: rule.templateName,
      eligibleChannels,
      blockedChannels,
      deferredChannels,
      idempotencyKeyPreview,
      truthfulnessCheck,
      requiredContactFields: rule.requiredContactFields,
      previewOnly: true,
      dryRunOnly: true,
      productionActivationStatus: rule.productionActivationStatus,
      noSendGuarantee: true,
    };
  }
}
