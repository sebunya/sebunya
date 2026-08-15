/**
 * Terminal outcomes AND the non-terminal lifecycle phases.
 *
 * The phases are not decoration: after a crash, PREPARED and DISPATCH_STARTED
 * are the only things that distinguish "we never sent it" from "the provider
 * may already have it" — which decides whether replacing a reset credential is
 * safe. PENDING is included because the database column has always defaulted to
 * it; the union simply never admitted a state the schema could produce.
 *
 * Semantics and the legal transition graph live in
 * domain/notifications/AttemptLifecycle.
 */
export type NotificationStatus =
  | 'PENDING'
  | 'PREPARED'
  | 'DISPATCH_STARTED'
  | 'SENT'
  | 'FAILED'
  | 'OUTCOME_UNKNOWN'
  | 'NOT_DISPATCHED'
  | 'DRY_RUN'
  | 'NOT_CONFIGURED'
  | 'DISABLED';

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
}

export interface INotificationProvider {
  dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult>;
}
