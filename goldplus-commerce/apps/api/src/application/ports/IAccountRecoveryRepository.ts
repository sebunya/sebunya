/**
 * Account recovery (0106).
 *
 * The raw reset token exists in exactly two places: the message sent to the
 * customer, and the link they click. It is never stored, never logged, and
 * never returned by any read here — only its SHA-256 is persisted, so a
 * database read cannot be replayed into an account takeover.
 */

export interface IssuedResetToken {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface ResolvedResetToken {
  id: string;
  userId: string;
  email: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface IAccountRecoveryRepository {
  /**
   * Store the HASH of a freshly minted token. The caller keeps the raw value
   * just long enough to put it in the message.
   */
  issueToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<IssuedResetToken>;

  /** Look a token up by its hash. Returns null for anything unrecognised. */
  findByTokenHash(tokenHash: string): Promise<ResolvedResetToken | null>;

  /**
   * Consume the token and set the new password in ONE transaction, and stamp
   * `users.sessions_invalidated_after` so every session issued before the
   * reset dies with it.
   *
   * Atomic on purpose: a token consumed without the password changing locks
   * the customer out, and a password changed without consuming the token
   * leaves a working takeover link in an inbox.
   *
   * Returns false when the token was already consumed — which is what a
   * replayed link looks like.
   */
  consumeAndSetPassword(input: {
    tokenId: string;
    userId: string;
    newPasswordHash: string;
  }): Promise<boolean>;

  /** How many tokens this user has been issued since `since` — the throttle. */
  countRecentTokens(userId: string, since: Date): Promise<number>;

  /** Invalidate every outstanding token for a user (e.g. after a successful reset). */
  invalidateOutstanding(userId: string): Promise<number>;
}
