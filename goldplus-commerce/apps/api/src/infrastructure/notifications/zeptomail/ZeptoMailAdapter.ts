import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from '../../../application/ports/INotificationProvider';

export class ZeptoMailAdapter implements INotificationProvider {
  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    const token = (process.env.ZEPTOMAIL_API_TOKEN || '').trim();
    const fromAddr = (process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim();

    if (!token || !fromAddr) {
      return {
        status: 'NOT_CONFIGURED',
        providerCode: 'NO_CREDENTIALS',
        providerMessage: 'ZEPTOMAIL_API_TOKEN or ZEPTOMAIL_FROM_ADDRESS is missing in environment.',
      };
    }

    // Instruction: Do not call real ZeptoMail API yet.
    return {
      status: 'NOT_CONFIGURED',
      providerCode: 'PROVIDER_NOT_WIRED',
      providerMessage: 'ZeptoMail SMTP gateway integration pending in Phase 1.1. Credentials exist but transport not built.',
    };
  }
}
