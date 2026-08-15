/**
 * The password-reset delivery state machine.
 *
 * A pure decision module. No Drizzle, no provider SDK, no clock of its own —
 * the caller passes a snapshot, so every branch is exhaustively testable and
 * the same input always yields the same decision. Workers ask; they do not
 * decide.
 *
 * THREE OBJECTS, NOT ONE
 *
 *   RESET OPERATION   what the customer started. Durable. Bounded lifetime.
 *   TOKEN ATTEMPT     one credential belonging to it. Secret, disposable.
 *   DELIVERY ATTEMPT  one provider request for that operation. Retryable, but
 *                     only under explicit conditions.
 *
 * Conflating them is what produced the defect this exists to fix: a reset token
 * in PostgreSQL was treated as a delivered password-reset experience, and one
 * refused provider call destroyed the customer's whole security transaction.
 *
 * THE RULE THAT SHAPES EVERYTHING ELSE
 *
 * We may only rotate a token when the provider has PROVEN it did not accept the
 * message. If we cannot prove that — a timeout, a dropped connection, a worker
 * that died mid-call — the email may already be in flight carrying the current
 * token, and superseding it would invalidate a link the customer is about to
 * receive. Uncertainty therefore never becomes a resend. It becomes AMBIGUOUS,
 * and AMBIGUOUS does nothing at all.
 */

import {
  classifyTransactionalEmailFailure,
  type RedactedTransactionalEmailFailure,
} from '../../application/services/consent/TransactionalEmailFailureForensics';

/** How long the customer's reset operation may live, whatever happens to it. */
export const OPERATION_TTL_MS = 60 * 60 * 1000;

/** How long any single token may live. Never beyond the operation. */
export const TOKEN_TTL_MS = 60 * 60 * 1000;

/** Bounded, and additionally bounded by the operation lifetime (whichever first). */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Backoff used when the provider gives us no usable Retry-After. */
const BACKOFF_SECONDS = [60, 300, 900, 3600];

/* ── provider outcome ─────────────────────────────────────────────────── */

export type ProviderOutcome =
  /** The provider's own answer says it took the message. */
  | { kind: 'ACCEPTED'; providerReference: string | null }
  /**
   * The provider answered, and the answer proves the message was NOT taken.
   * Only this kind may ever lead to token rotation.
   */
  | {
      kind: 'DEFINITIVELY_REJECTED';
      classification: RedactedTransactionalEmailFailure['classification'];
      disposition: 'RETRYABLE' | 'NON_RETRYABLE' | 'OWNER_ACTION_REQUIRED' | 'UNKNOWN';
      retryAfterSeconds: number | null;
    }
  /** We cannot prove either way. The message may be in flight. */
  | { kind: 'AMBIGUOUS'; reason: string };

/**
 * Turns a real provider response into an outcome.
 *
 * `responded: false` is the whole point of the signature. A transport that
 * never produced a response — timeout, reset, crash — cannot be classified from
 * a status code, because there is no status code, and guessing "failed" there is
 * exactly how a delivered reset link gets invalidated underneath a customer.
 */
export const classifyProviderResponse = (input: {
  responded: boolean;
  httpStatus?: number | null;
  providerBody?: string | null;
  retryAfterSeconds?: number | null;
  providerReference?: string | null;
  transportError?: string | null;
}): ProviderOutcome => {
  if (!input.responded) {
    return {
      kind: 'AMBIGUOUS',
      reason: input.transportError ?? 'NO_PROVIDER_RESPONSE',
    };
  }

  const status = input.httpStatus ?? null;
  if (status !== null && status >= 200 && status < 300) {
    return { kind: 'ACCEPTED', providerReference: input.providerReference ?? null };
  }

  // The canonical forensics classifier, fed the provider's own words. Status
  // alone collapses every 429 to `rate_limited`, which is the least actionable
  // answer available and cannot tell a burst limit from an unverified domain.
  const failure = classifyTransactionalEmailFailure({
    response_status: status,
    provider_code: input.providerBody ?? undefined,
  });

  const disposition =
    failure.requires_provider_action
      ? 'OWNER_ACTION_REQUIRED'
      : failure.retryable === 'yes'
        ? 'RETRYABLE'
        : failure.retryable === 'no'
          ? 'NON_RETRYABLE'
          : 'UNKNOWN';

  return {
    kind: 'DEFINITIVELY_REJECTED',
    classification: failure.classification,
    disposition,
    retryAfterSeconds: input.retryAfterSeconds ?? null,
  };
};

/* ── operation actionability ──────────────────────────────────────────── */

export interface ResetOperationSnapshot {
  operationId: string;
  /** The ROOT token's creation time. Never moves, so rotation cannot extend life. */
  rootCreatedAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  supersededByNewerUserRequest: boolean;
  deliveryAttempts: number;
}

export type OperationBlocked =
  | 'CONSUMED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'ATTEMPT_CEILING_REACHED';

export const operationExpiresAt = (snapshot: ResetOperationSnapshot): Date =>
  new Date(snapshot.rootCreatedAt.getTime() + OPERATION_TTL_MS);

/**
 * Why this operation may not proceed, or null if it may.
 *
 * Evaluated before EVERY token creation and EVERY provider request, not once at
 * the start: a retry scheduled an hour ago knows nothing about the password the
 * customer reset in the meantime.
 */
export const operationBlockedBy = (
  snapshot: ResetOperationSnapshot,
  now: Date,
): OperationBlocked | null => {
  if (snapshot.consumedAt) return 'CONSUMED';
  if (snapshot.revokedAt) return 'REVOKED';
  if (snapshot.supersededByNewerUserRequest) return 'SUPERSEDED';
  if (operationExpiresAt(snapshot).getTime() <= now.getTime()) return 'EXPIRED';
  if (snapshot.deliveryAttempts >= MAX_DELIVERY_ATTEMPTS) return 'ATTEMPT_CEILING_REACHED';
  return null;
};

/**
 * A token may never outlive its operation.
 *
 * Without this clamp, rotating near the end of an operation would mint a
 * credential valid after the operation itself had expired — the operation bound
 * would be advisory rather than real.
 */
export const tokenExpiresAt = (snapshot: ResetOperationSnapshot, now: Date): Date => {
  const byToken = now.getTime() + TOKEN_TTL_MS;
  const byOperation = operationExpiresAt(snapshot).getTime();
  return new Date(Math.min(byToken, byOperation));
};

/* ── what to do after a provider result ───────────────────────────────── */

export type DeliveryDecision =
  /** Provider took it. Leave the current token alone. */
  | { action: 'KEEP_CURRENT_TOKEN'; reason: string }
  /**
   * Provider proved non-acceptance and the failure is retryable: retire the
   * failed token NOW and schedule. During the wait the operation deliberately
   * has NO current token — the message was never accepted, so leaving a usable
   * credential alive would be exposure with no purpose.
   */
  | { action: 'SUPERSEDE_AND_SCHEDULE_RETRY'; nextAttemptAt: Date; reason: string }
  /** Terminal. No further automated provider contact. */
  | { action: 'TERMINAL'; terminalReason: string }
  /** Fail closed: do nothing at all, and say why. */
  | { action: 'HOLD'; reason: string };

export const decideAfterProviderOutcome = (input: {
  outcome: ProviderOutcome;
  snapshot: ResetOperationSnapshot;
  now: Date;
}): DeliveryDecision => {
  const { outcome, snapshot, now } = input;

  if (outcome.kind === 'ACCEPTED') {
    return { action: 'KEEP_CURRENT_TOKEN', reason: 'PROVIDER_ACCEPTED' };
  }

  if (outcome.kind === 'AMBIGUOUS') {
    // The single most important branch in this file. We do NOT rotate, do NOT
    // resend and do NOT mark failure: an email carrying the current token may
    // already be on its way to the customer.
    return { action: 'HOLD', reason: `PROVIDER_OUTCOME_AMBIGUOUS:${outcome.reason}` };
  }

  if (outcome.disposition === 'OWNER_ACTION_REQUIRED') {
    // Retrying an unverified domain or an exhausted plan just burns attempts
    // against a problem only a human can clear.
    return { action: 'TERMINAL', terminalReason: `OWNER_ACTION_REQUIRED:${outcome.classification}` };
  }
  if (outcome.disposition === 'NON_RETRYABLE') {
    return { action: 'TERMINAL', terminalReason: `NON_RETRYABLE:${outcome.classification}` };
  }
  if (outcome.disposition === 'UNKNOWN') {
    // A response we cannot classify is not permission to retry.
    return { action: 'HOLD', reason: `UNCLASSIFIED_PROVIDER_FAILURE:${outcome.classification}` };
  }

  // Definitive + retryable. Still only if the operation itself is still worth
  // delivering to.
  const blocked = operationBlockedBy(snapshot, now);
  if (blocked) return { action: 'TERMINAL', terminalReason: `OBSOLETE_${blocked}` };

  const nextAttemptAt = nextAttemptTime({
    attempts: snapshot.deliveryAttempts,
    retryAfterSeconds: outcome.retryAfterSeconds,
    now,
  });

  // Never schedule past the point where the operation would already be dead.
  if (nextAttemptAt.getTime() >= operationExpiresAt(snapshot).getTime()) {
    return { action: 'TERMINAL', terminalReason: 'OBSOLETE_RETRY_WOULD_FALL_AFTER_OPERATION_EXPIRY' };
  }

  return {
    action: 'SUPERSEDE_AND_SCHEDULE_RETRY',
    nextAttemptAt,
    reason: `RETRYABLE:${outcome.classification}`,
  };
};

/**
 * When the next attempt may happen.
 *
 * A valid Retry-After is a hard lower bound, never merely a hint: retrying
 * sooner than the provider allowed is how a rate limit becomes a ban.
 */
export const nextAttemptTime = (input: {
  attempts: number;
  retryAfterSeconds: number | null;
  now: Date;
}): Date => {
  const backoff = BACKOFF_SECONDS[Math.min(input.attempts, BACKOFF_SECONDS.length - 1)];
  const seconds =
    input.retryAfterSeconds !== null && input.retryAfterSeconds > 0
      ? Math.max(input.retryAfterSeconds, backoff)
      : backoff;
  return new Date(input.now.getTime() + seconds * 1000);
};

/**
 * May a worker mint a replacement token and call the provider right now?
 *
 * Separate from `decideAfterProviderOutcome` on purpose: that one runs with a
 * fresh provider answer in hand, this one runs much later, when the world has
 * had time to change underneath the schedule.
 */
export const canAttemptDeliveryNow = (input: {
  snapshot: ResetOperationSnapshot;
  nextAttemptAt: Date | null;
  hasCurrentToken: boolean;
  now: Date;
}): { allowed: boolean; reason: string } => {
  const blocked = operationBlockedBy(input.snapshot, input.now);
  if (blocked) return { allowed: false, reason: `BLOCKED_${blocked}` };

  if (input.hasCurrentToken) {
    // Either the provider accepted the last send, or the outcome was ambiguous.
    // Both mean a live credential may be in the customer's hands already.
    return { allowed: false, reason: 'CURRENT_TOKEN_STILL_LIVE' };
  }

  if (input.nextAttemptAt && input.nextAttemptAt.getTime() > input.now.getTime()) {
    return { allowed: false, reason: 'BACKOFF_NOT_ELAPSED' };
  }

  return { allowed: true, reason: 'ELIGIBLE' };
};
