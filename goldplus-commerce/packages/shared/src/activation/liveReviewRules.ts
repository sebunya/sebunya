/**
 * Controlled-activation live review: what may happen to a candidate next.
 *
 * ONE statement of the rules, read by the API use cases that enforce them and
 * by the admin page that offers the buttons. They drifted once: the page
 * offered "Run readiness checks" only to DRAFT candidates — a status no
 * candidate ever has (they are created READY_FOR_REVIEW) — so checks could not
 * be run from the page, and approval, which requires checks, could never
 * succeed. Found by driving the page end to end, 2026-09-23.
 */

/** A readiness check in any of these statuses blocks approval. */
export const LIVE_REVIEW_BLOCKING_CHECK_STATUSES: readonly string[] = ['BLOCKED', 'EXPIRED', 'NOT_CONFIGURED', 'CONSENT_BLOCKED'];

export function liveReviewHasBlockers(checks: ReadonlyArray<{ status: string }>): boolean {
  return checks.some((c) => LIVE_REVIEW_BLOCKING_CHECK_STATUSES.includes(c.status));
}

/** Candidate statuses in which readiness checks may be (re-)run. */
export const LIVE_REVIEW_CHECKABLE_STATUSES: readonly string[] = ['READY_FOR_REVIEW', 'BLOCKED'];

export interface LiveReviewNextActions {
  canRunChecks: boolean;
  canBuildRunbook: boolean;
  canDecide: boolean;
  /** Why approve/reject is not offered, in plain words (null when it is). */
  decideBlockedBecause: string | null;
}

export function liveReviewNextActions(input: {
  status: string;
  checks: ReadonlyArray<{ status: string }>;
  hasRunbook: boolean;
  activationWindowEnd: Date | string | null;
  now?: Date;
}): LiveReviewNextActions {
  const now = input.now ?? new Date();
  const ready = input.status === 'READY_FOR_REVIEW';
  const windowEnd = input.activationWindowEnd ? new Date(input.activationWindowEnd) : null;
  const decideBlockedBecause =
    input.status === 'BLOCKED' ? 'Readiness checks found blockers. Resolve them and run the checks again.'
      : !ready ? `The candidate is ${input.status}; nothing is left to decide.`
        : input.checks.length === 0 ? 'Run the readiness checks first — a decision needs their results.'
          : liveReviewHasBlockers(input.checks) ? 'A readiness check is blocking. Resolve it and run the checks again.'
            : windowEnd && now > windowEnd ? 'The activation window has ended.'
              : null;
  return {
    canRunChecks: LIVE_REVIEW_CHECKABLE_STATUSES.includes(input.status),
    canBuildRunbook: ready && !input.hasRunbook,
    canDecide: decideBlockedBecause === null,
    decideBlockedBecause,
  };
}
