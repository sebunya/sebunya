import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from '../../../application/ports/INotificationProvider';

export class DisabledSmsAdapter implements INotificationProvider {
  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    return {
      status: 'DISABLED',
      providerCode: 'CHANNEL_DISABLED',
      providerMessage: 'SMS Channel is explicitly disabled in Phase 1 business logic.',
    };
  }
}
