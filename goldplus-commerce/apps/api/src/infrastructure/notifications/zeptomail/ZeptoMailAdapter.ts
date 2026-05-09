import { INotificationProvider, NotificationResult } from '../../../application/ports/INotificationProvider';

export class ZeptoMailAdapter implements INotificationProvider {
  async send(recipient: string, message: string): Promise<NotificationResult> {
    // Log the attempt
    console.warn(`[NOT_CONFIGURED] Attempted to send Email to ${recipient}, but provider is not configured.`);
    return {
      success: false,
      code: "NOT_CONFIGURED",
      message: "ZeptoMail provider is not configured"
    };
  }
}
