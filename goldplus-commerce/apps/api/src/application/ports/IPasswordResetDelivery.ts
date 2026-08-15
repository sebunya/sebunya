/**
 * Durable state for password-reset delivery (B+, MODEL_T).
 *
 * Three objects, deliberately separate:
 *
 *   RESET OPERATION   what the customer asked for. The root token row IS it.
 *   TOKEN ATTEMPT     one credential belonging to that operation.
 *   PROVIDER ATTEMPT  one delivery attempt for one specific token.
 *
 * The provider attempt points at the EXACT token it carried, never at "the
 * latest token" — after a rotation those are different rows, and resolving it
 * late would attribute a send to a credential it never contained.
 */

/**
 * The outbox event type carrying a reset delivery intent.
 *
 * It MUST be excluded from the general notification worker. That worker routes
 * an event to a provider by looking up a channel and a recipient; a reset
 * intent has neither, because the token does not exist yet at retry time. Left
 * unexcluded it would be claimed, found unroutable, and marked processed with
 * 'No channel mapping for this event type.' — destroying the customer's
 * delivery intent silently, which is exactly what happened to fulfilment tasks
 * before the checkout-side-effect partition existed.
 */
export const PASSWORD_RESET_DELIVERY_EVENT_TYPE = 'PASSWORD_RESET_DELIVERY';

export interface PasswordResetOperationSnapshot {
  operationId: string;
  userId: string;
  recipientEmail: string;
  /** The ROOT token's creation time. Never moves, so rotation cannot extend life. */
  rootCreatedAt: Date;
  /**
   * Operation-WIDE consumption: true when ANY token of this operation completed
   * the reset. Asking only the current token would let a retry fire after the
   * customer had already changed their password with an earlier one.
   */
  consumedAt: Date | null;
  /** The one unconsumed, unsuperseded token, if any. Zero during retry backoff. */
  currentToken: { id: string; expiresAt: Date } | null;
  /**
   * Provider attempts that actually crossed the dispatch boundary. Local aborts
   * are excluded on purpose: a crash before dispatch cost the provider nothing
   * and must not consume the retry budget.
   */
  dispatchedAttempts: number;
}

export interface IPasswordResetDeliveryRepository {
  /**
   * ONE transaction: root token, secret-free delivery intent, PREPARED attempt.
   *
   * All three or none. A token with no intent is a reset nobody will ever
   * retry; an intent with no token is a delivery for a reset that does not
   * exist; and an intent with no attempt leaves a crash gap where nothing
   * records that a send was owed.
   */
  createOperation(input: {
    userId: string;
    tokenHash: string;
    tokenExpiresAt: Date;
    requestedIp: string | null;
    recipientEmail: string;
    /**
     * When a recovery worker may take this over. Set beyond the originating
     * request's plausible lifetime, so the worker cannot race a live request.
     */
    workerEligibleAt: Date;
  }): Promise<{ operationId: string; tokenId: string; attemptId: string }>;

  /** Everything needed to decide, in one authoritative read. Null when orphaned. */
  loadOperation(operationId: string): Promise<PasswordResetOperationSnapshot | null>;

  /** Retire a token by rotation. Idempotent; false when it was not current. */
  supersedeToken(tokenId: string): Promise<boolean>;

  /**
   * Record a definitive retryable rejection: retire the failed token and arm
   * the intent, in one transaction. After it commits the operation has ZERO
   * current tokens — a credential the provider refused should not stay usable
   * through the wait.
   */
  supersedeAndScheduleRetry(input: {
    operationId: string;
    tokenId: string;
    nextAttemptAt: Date;
    reason: string;
  }): Promise<boolean>;

  /** Close the intent for good. No further automated provider contact. */
  finaliseIntent(input: { operationId: string; terminalReason: string }): Promise<boolean>;

  /**
   * Claim a due intent. Compare-and-set, so exactly one worker wins.
   * Returns the snapshot only to the winner.
   */
  claimDueIntent(now: Date, leaseUntil: Date): Promise<PasswordResetOperationSnapshot | null>;

  /**
   * ONE transaction: the replacement token and its PREPARED attempt.
   *
   * Minted only when a send is imminent — never at failure time — so no usable
   * credential exists during the backoff.
   */
  createRetryTokenAndAttempt(input: {
    operationId: string;
    tokenHash: string;
    tokenExpiresAt: Date;
    recipientEmail: string;
  }): Promise<{ tokenId: string; attemptId: string } | null>;
}
