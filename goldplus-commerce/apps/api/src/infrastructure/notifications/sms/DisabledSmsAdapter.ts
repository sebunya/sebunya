import { INotificationProvider, NotificationResult } from '../../../application/ports/INotificationProvider';

export class DisabledSmsAdapter implements INotificationProvider {
  async send(recipient: string, message: string): Promise<NotificationResult> {
    console.warn(`[DISABLED] Attempted to send SMS to ${recipient}, but SMS is intentionally disabled in Phase 1.`);
    return {
      success: false,
      code: "DISABLED",
      message: "SMS Provider is disabled for Phase 1"
    };
  }
}
