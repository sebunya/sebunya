import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from '../../../application/ports/INotificationProvider';

export class WhatsAppAdapter implements INotificationProvider {
  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    const token = (process.env.WHATSAPP_API_TOKEN || '').trim();
    const phoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

    if (!token || !phoneId) {
      return {
        status: 'NOT_CONFIGURED',
        providerCode: 'NO_CREDENTIALS',
        providerMessage: 'WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing in environment.',
      };
    }

    // Instruction: Do not call real WhatsApp API yet.
    return {
      status: 'NOT_CONFIGURED',
      providerCode: 'PROVIDER_NOT_WIRED',
      providerMessage: 'WhatsApp gateway integration pending in Phase 1.1. Credentials exist but payload not routed.',
    };
  }
}
