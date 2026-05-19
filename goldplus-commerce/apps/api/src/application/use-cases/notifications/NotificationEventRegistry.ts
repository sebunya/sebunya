export type NotificationChannel = 'email' | 'sms' | 'whatsapp_handoff' | 'whatsapp_api_deferred';

export interface NotificationEventRule {
  eventType: string;
  templateName: string;
  eligibleChannels: NotificationChannel[];
  deferredChannels: NotificationChannel[];
  blockedByDefaultChannels: NotificationChannel[];
  truthConditionKey: string;
  requiredContactFields: ('email' | 'phone')[];
  idempotencyKeyParts: string[];
  retryPolicyRecommendation: {
    maxAttempts: number;
    backoffBaseSeconds: number;
  };
  suppressionRules: string[];
  productionActivationStatus: 'active' | 'inactive' | 'deferred';
  dryRunOnly: boolean;
}

export class NotificationEventRegistry {
  private static readonly rules: Record<string, NotificationEventRule> = {
    ORDER_RECEIVED_UNPAID: {
      eventType: 'ORDER_RECEIVED_UNPAID',
      templateName: 'ORDER_RECEIVED_UNPAID',
      eligibleChannels: ['email', 'sms'],
      deferredChannels: ['whatsapp_api_deferred'],
      blockedByDefaultChannels: [],
      truthConditionKey: 'ORDER_UNPAID',
      requiredContactFields: ['email', 'phone'],
      idempotencyKeyParts: ['orderId', 'eventType', 'channel', 'templateName', 'paymentStatus', 'orderStatus', 'statusVersion'],
      retryPolicyRecommendation: {
        maxAttempts: 3,
        backoffBaseSeconds: 60,
      },
      suppressionRules: ['ORDER_PAID', 'ORDER_CANCELLED'],
      productionActivationStatus: 'deferred',
      dryRunOnly: true,
    },
    PAYMENT_PENDING_VERIFICATION: {
      eventType: 'PAYMENT_PENDING_VERIFICATION',
      templateName: 'ORDER_PAYMENT_PENDING',
      eligibleChannels: ['email'],
      deferredChannels: ['sms', 'whatsapp_api_deferred'],
      blockedByDefaultChannels: [],
      truthConditionKey: 'PAYMENT_PENDING',
      requiredContactFields: ['email'],
      idempotencyKeyParts: ['orderId', 'eventType', 'channel', 'templateName', 'paymentStatus', 'orderStatus', 'statusVersion'],
      retryPolicyRecommendation: {
        maxAttempts: 3,
        backoffBaseSeconds: 60,
      },
      suppressionRules: ['PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED_STABLE'],
      productionActivationStatus: 'deferred',
      dryRunOnly: true,
    },
    PAYMENT_SUCCESS: {
      eventType: 'PAYMENT_SUCCESS',
      templateName: 'ORDER_PAYMENT_SUCCESS',
      eligibleChannels: ['email', 'sms'],
      deferredChannels: ['whatsapp_api_deferred'],
      blockedByDefaultChannels: [],
      truthConditionKey: 'PAYMENT_PAID',
      requiredContactFields: ['email', 'phone'],
      idempotencyKeyParts: ['orderId', 'eventType', 'channel', 'templateName', 'paymentStatus', 'orderStatus', 'statusVersion'],
      retryPolicyRecommendation: {
        maxAttempts: 5,
        backoffBaseSeconds: 60,
      },
      suppressionRules: [],
      productionActivationStatus: 'deferred',
      dryRunOnly: true,
    },
    PAYMENT_FAILED: {
      eventType: 'PAYMENT_FAILED',
      templateName: 'ORDER_PAYMENT_FAILED',
      eligibleChannels: ['email', 'sms'],
      deferredChannels: ['whatsapp_api_deferred'],
      blockedByDefaultChannels: [],
      truthConditionKey: 'PAYMENT_FAILED',
      requiredContactFields: ['email', 'phone'],
      idempotencyKeyParts: ['orderId', 'eventType', 'channel', 'templateName', 'paymentStatus', 'orderStatus', 'statusVersion'],
      retryPolicyRecommendation: {
        maxAttempts: 3,
        backoffBaseSeconds: 60,
      },
      suppressionRules: ['PAYMENT_SUCCESSFUL'],
      productionActivationStatus: 'deferred',
      dryRunOnly: true,
    },
    ORDER_CANCELLED: {
      eventType: 'ORDER_CANCELLED',
      templateName: 'ORDER_PAYMENT_CANCELLED',
      eligibleChannels: ['email'],
      deferredChannels: ['sms', 'whatsapp_api_deferred'],
      blockedByDefaultChannels: [],
      truthConditionKey: 'ORDER_CANCELLED',
      requiredContactFields: ['email'],
      idempotencyKeyParts: ['orderId', 'eventType', 'channel', 'templateName', 'paymentStatus', 'orderStatus', 'statusVersion'],
      retryPolicyRecommendation: {
        maxAttempts: 3,
        backoffBaseSeconds: 60,
      },
      suppressionRules: [],
      productionActivationStatus: 'deferred',
      dryRunOnly: true,
    },
    ORDER_PROCESSING: {
      eventType: 'ORDER_PROCESSING',
      templateName: 'ORDER_FULFILLMENT_PROCESSING',
      eligibleChannels: ['email'],
      deferredChannels: ['sms', 'whatsapp_api_deferred'],
      blockedByDefaultChannels: [],
      truthConditionKey: 'ORDER_PREPARING',
      requiredContactFields: ['email'],
      idempotencyKeyParts: ['orderId', 'eventType', 'channel', 'templateName', 'paymentStatus', 'orderStatus', 'statusVersion'],
      retryPolicyRecommendation: {
        maxAttempts: 3,
        backoffBaseSeconds: 60,
      },
      suppressionRules: ['ORDER_COMPLETED'],
      productionActivationStatus: 'deferred',
      dryRunOnly: true,
    },
    ORDER_FULFILLED: {
      eventType: 'ORDER_FULFILLED',
      templateName: 'ORDER_FULFILLMENT_COMPLETED',
      eligibleChannels: ['email', 'sms'],
      deferredChannels: ['whatsapp_api_deferred'],
      blockedByDefaultChannels: [],
      truthConditionKey: 'ORDER_COMPLETED',
      requiredContactFields: ['email', 'phone'],
      idempotencyKeyParts: ['orderId', 'eventType', 'channel', 'templateName', 'paymentStatus', 'orderStatus', 'statusVersion'],
      retryPolicyRecommendation: {
        maxAttempts: 3,
        backoffBaseSeconds: 60,
      },
      suppressionRules: [],
      productionActivationStatus: 'deferred',
      dryRunOnly: true,
    },
    SUPPORT_HANDOFF: {
      eventType: 'SUPPORT_HANDOFF',
      templateName: 'SUPPORT_HANDOFF',
      eligibleChannels: ['whatsapp_handoff'],
      deferredChannels: [],
      blockedByDefaultChannels: ['email', 'sms', 'whatsapp_api_deferred'],
      truthConditionKey: 'SUPPORT_CLICK',
      requiredContactFields: [],
      idempotencyKeyParts: [],
      retryPolicyRecommendation: {
        maxAttempts: 1,
        backoffBaseSeconds: 0,
      },
      suppressionRules: [],
      productionActivationStatus: 'active',
      dryRunOnly: false, // Since this is client-side, it triggers instantly
    },
  };

  public static getRule(eventType: string): NotificationEventRule | null {
    return this.rules[eventType] || null;
  }

  public static getAllRules(): NotificationEventRule[] {
    return Object.values(this.rules);
  }
}
