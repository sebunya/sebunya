/**
 * The provider-attempt lifecycle.
 *
 * A provider attempt used to be a single row written once, after the fact, with
 * a terminal status. That is enough to say what happened when nothing goes
 * wrong, and useless when a process dies mid-send — the case that matters,
 * because a password-reset email carries a credential.
 *
 * The lifecycle exists to answer ONE question after a crash:
 *
 *   Might the provider already have the message?
 *
 * PREPARED says no: the attempt exists but nothing was dispatched.
 * DISPATCH_STARTED says maybe: we durably crossed the boundary first, so the
 * request may have gone out even though we never saw the answer.
 *
 * That distinction is the difference between safely minting a replacement
 * credential and invalidating a reset link already in someone's inbox.
 *
 * WHY PENDING IS HERE. The database column defaults to 'PENDING' and always
 * has; the TypeScript union simply never admitted it. No production row carries
 * it today because every writer sets a status explicitly, but a type that calls
 * a reachable state impossible is a type that will eventually be wrong. It is
 * modelled as the legacy non-terminal state, and B+ never writes it.
 */

export type NotificationAttemptStatus =
  /** Legacy/generic non-terminal. The DB default; B+ never writes it. */
  | 'PENDING'
  /** Attempt exists durably. The dispatch boundary has NOT been crossed. */
  | 'PREPARED'
  /** We durably crossed the boundary. The provider MAY have the message. */
  | 'DISPATCH_STARTED'
  /** The provider definitively accepted it. NOT proof of mailbox delivery. */
  | 'SENT'
  /** The provider definitively refused it. */
  | 'FAILED'
  /** Dispatch began; acceptance can be proven neither way. */
  | 'OUTCOME_UNKNOWN'
  /**
   * We never dispatched this attempt at all — the process died before the
   * boundary, or a send-time check refused it.
   *
   * Deliberately NOT `FAILED`: the provider never rejected anything, and
   * counting it as a provider failure would slander a working provider and
   * corrupt every delivery metric. Equally NOT `OUTCOME_UNKNOWN`: there is no
   * uncertainty here, we know precisely that nothing left the building.
   */
  | 'NOT_DISPATCHED'
  /** Existing intentional terminal outcomes. */
  | 'DRY_RUN'
  | 'NOT_CONFIGURED'
  | 'DISABLED';

const TERMINAL: ReadonlySet<NotificationAttemptStatus> = new Set([
  'SENT',
  'FAILED',
  'OUTCOME_UNKNOWN',
  'NOT_DISPATCHED',
  'DRY_RUN',
  'NOT_CONFIGURED',
  'DISABLED',
]);

const IN_FLIGHT: ReadonlySet<NotificationAttemptStatus> = new Set([
  'PENDING',
  'PREPARED',
  'DISPATCH_STARTED',
]);

/** Finished, whatever the ending. */
export const isTerminalAttemptStatus = (status: string): boolean =>
  TERMINAL.has(status as NotificationAttemptStatus);

/**
 * Legitimately still going.
 *
 * Health and metrics must consult this rather than assuming "not SENT means
 * broken": an attempt that is two seconds old and mid-flight is the system
 * working, not the system failing.
 */
export const isInFlightAttemptStatus = (status: string): boolean =>
  IN_FLIGHT.has(status as NotificationAttemptStatus);

/** The provider took it. Says nothing about the mailbox. */
export const isProviderAcceptedStatus = (status: string): boolean => status === 'SENT';

/** The provider refused it — as opposed to us never asking. */
export const isProviderRejectedStatus = (status: string): boolean => status === 'FAILED';

/** Dispatch happened; the answer did not survive. */
export const isAmbiguousAttemptStatus = (status: string): boolean => status === 'OUTCOME_UNKNOWN';

/** We never dispatched. Not a provider failure, and must never be counted as one. */
export const isLocalPreDispatchTerminalStatus = (status: string): boolean =>
  status === 'NOT_DISPATCHED';

/**
 * The permitted transitions, exhaustively.
 *
 * A terminal status has no outgoing edges at all. That is what stops a late or
 * duplicated writer from rewriting a decided outcome — turning a FAILED back
 * into DISPATCH_STARTED would re-open a closed security decision, and
 * OUTCOME_UNKNOWN must stay ambiguous rather than being quietly resolved by
 * whichever worker woke last.
 *
 * A future provider-reconciliation contract could justify OUTCOME_UNKNOWN →
 * SENT. ZeptoMail exposes no such lookup, so that edge does not exist.
 */
const ALLOWED: Readonly<Record<NotificationAttemptStatus, readonly NotificationAttemptStatus[]>> = {
  PENDING: ['PREPARED', 'NOT_DISPATCHED'],
  PREPARED: ['DISPATCH_STARTED', 'NOT_DISPATCHED'],
  DISPATCH_STARTED: ['SENT', 'FAILED', 'OUTCOME_UNKNOWN'],
  SENT: [],
  FAILED: [],
  OUTCOME_UNKNOWN: [],
  NOT_DISPATCHED: [],
  DRY_RUN: [],
  NOT_CONFIGURED: [],
  DISABLED: [],
};

export const isAllowedAttemptTransition = (
  from: NotificationAttemptStatus,
  to: NotificationAttemptStatus,
): boolean => (ALLOWED[from] ?? []).includes(to);

/** Every legal edge, for tests and for the operator-facing documentation. */
export const attemptTransitionGraph = (): ReadonlyArray<
  readonly [NotificationAttemptStatus, NotificationAttemptStatus]
> =>
  (Object.keys(ALLOWED) as NotificationAttemptStatus[]).flatMap((from) =>
    ALLOWED[from].map((to) => [from, to] as const),
  );
