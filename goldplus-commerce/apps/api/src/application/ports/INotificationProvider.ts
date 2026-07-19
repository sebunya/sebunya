export type NotificationStatus = 'SENT' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'DRY_RUN' | 'NOT_CONFIGURED' | 'DISABLED';

export interface NotificationDispatchPayload {
  recipient: string;
  template: string;
  data: Record<string, unknown>;
  relatedEntity: string;
  relatedEntityId: string;
}

export interface NotificationDispatchResult {
  status: NotificationStatus;
  providerCode: string | null;
  providerMessage: string;
}

export interface INotificationProvider {
  dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult>;
}
