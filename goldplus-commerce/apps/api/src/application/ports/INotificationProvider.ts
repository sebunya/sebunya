export type NotificationStatus = 'SENT' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'DRY_RUN' | 'NOT_CONFIGURED' | 'DISABLED';

export interface NotificationDispatchPayload {
  recipient: string;
  template: string;
  data: Record<string, unknown>;
  relatedEntity: string;
  /**
   * The related row, or null when the notification legitimately has none — a
   * phone-verification SMS relates to a phone number, not to a uuid.
   *
   * This was typed `string`, which forced the router to spell absence as '' and
   * sent that straight into a `uuid` column. The type is now the same shape as
   * the column and as RecordNotificationAttemptInput, so absence has exactly one
   * representation on the whole path.
   */
  relatedEntityId: string | null;
}

export interface NotificationDispatchResult {
  status: NotificationStatus;
  providerCode: string | null;
  providerMessage: string;
  /**
   * False when the provider's own answer says retrying cannot help — an
   * exhausted credit balance, an unverified sender, a rejected recipient.
   * Production spent 244 attempts re-sending into "Credit exhausted", which
   * both wasted the budget and dressed an account problem up as a passing blip.
   * Omitted means "unknown", which retries as before.
   */
  retryable?: boolean;
}

export interface INotificationProvider {
  dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult>;
}
