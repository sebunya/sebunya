/**
 * Confirming an asynchronous audience upload (docs/advertising/README.md,
 * "Audiences: Google confirms later").
 *
 * Google's Data Manager API accepts audienceMembers:ingest and :removeAll
 * with only a requestId. The outcome is read later from
 * requestStatus:retrieve, per destination: SUCCESS, PARTIAL_SUCCESS, FAILED,
 * PROCESSING or REQUEST_STATUS_UNKNOWN. A run is therefore logged SUBMITTED
 * and walks this small state machine from the 5-minute tick:
 *
 *   WAITING   ingest requests sent; every one SUCCESS → send the stale-member
 *             sweep (removeAll with removeAsOfTime = the run's start) → SWEEPING;
 *             any FAILED/PARTIAL → FAILED/PARTIAL, and NO sweep (a sweep after
 *             an incomplete upload could remove people who are still eligible).
 *   SWEEPING  the sweep request; SUCCESS → CONFIRMED; otherwise FAILED.
 *   A CLEAR run (emptying a list) has no sweep: SUCCESS → CONFIRMED.
 *   Still processing after CONFIRMATION_GIVE_UP_MS → UNCONFIRMED (shown, never
 *   reported as a success).
 *
 * Pure: no I/O. The use case reads statuses through the gateway.
 */

export type RemoteRequestStatus = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'PROCESSING' | 'REQUEST_STATUS_UNKNOWN';

/** One request's status as the platform reported it, per destination. */
export interface RemoteRequestOutcome {
  requestId: string;
  statuses: RemoteRequestStatus[];
  /** Short, token-free error summaries (e.g. "INVALID_EMAIL_FORMAT: 3 records"). */
  errors: string[];
}

export type Confirmation = 'WAITING' | 'SWEEPING' | 'CONFIRMED' | 'PARTIAL' | 'FAILED' | 'UNCONFIRMED';

export interface RemoteRequests {
  kind: 'REPLACE' | 'CLEAR';
  ingest: string[];
  sweep: string | null;
}

/** How long a run may stay unconfirmed before it is marked UNCONFIRMED. */
export const CONFIRMATION_GIVE_UP_MS = 48 * 3600_000;

const KNOWN: RemoteRequestStatus[] = ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'PROCESSING', 'REQUEST_STATUS_UNKNOWN'];
export const asRemoteStatus = (v: unknown): RemoteRequestStatus => (KNOWN.includes(v as RemoteRequestStatus) ? (v as RemoteRequestStatus) : 'REQUEST_STATUS_UNKNOWN');

/**
 * The combined outcome of a set of requests.
 *  - any request still processing (or with no status yet) → PROCESSING;
 *  - every destination of every request SUCCESS → SUCCESS;
 *  - every one FAILED → FAILED;
 *  - otherwise → PARTIAL_SUCCESS.
 * No requests at all is PROCESSING (nothing has been confirmed).
 */
export function combineOutcomes(outcomes: RemoteRequestOutcome[]): { status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'PROCESSING'; errors: string[] } {
  const errors = [...new Set(outcomes.flatMap((o) => o.errors))].slice(0, 10);
  const all = outcomes.flatMap((o) => (o.statuses.length ? o.statuses : ['REQUEST_STATUS_UNKNOWN' as const]));
  if (outcomes.length === 0 || all.some((s) => s === 'PROCESSING' || s === 'REQUEST_STATUS_UNKNOWN')) return { status: 'PROCESSING', errors };
  if (all.every((s) => s === 'SUCCESS')) return { status: 'SUCCESS', errors };
  if (all.every((s) => s === 'FAILED')) return { status: 'FAILED', errors };
  return { status: 'PARTIAL_SUCCESS', errors };
}

export type ConfirmationStep =
  | { action: 'WAIT' }
  | { action: 'SWEEP' }
  | { action: 'FINISH'; confirmation: Exclude<Confirmation, 'WAITING' | 'SWEEPING'>; detail: string };

/** The next step for one run, from its state, its requests' combined outcome and its age. */
export function nextConfirmationStep(input: {
  confirmation: 'WAITING' | 'SWEEPING';
  kind: RemoteRequests['kind'];
  outcome: ReturnType<typeof combineOutcomes>;
  ageMs: number;
}): ConfirmationStep {
  const { outcome } = input;
  const why = outcome.errors.length ? ` Google reported: ${outcome.errors.join('; ')}.` : '';
  if (outcome.status === 'PROCESSING') {
    if (input.ageMs > CONFIRMATION_GIVE_UP_MS) {
      return { action: 'FINISH', confirmation: 'UNCONFIRMED', detail: 'Google had not confirmed this upload after 48 hours. It is not counted as a success; the next daily sync sends the list again.' };
    }
    return { action: 'WAIT' };
  }
  if (input.confirmation === 'WAITING') {
    if (outcome.status === 'SUCCESS') {
      if (input.kind === 'CLEAR') return { action: 'FINISH', confirmation: 'CONFIRMED', detail: 'Google confirmed the list was emptied.' };
      return { action: 'SWEEP' };
    }
    if (outcome.status === 'PARTIAL_SUCCESS') {
      return { action: 'FINISH', confirmation: 'PARTIAL', detail: `Google accepted only part of the upload, so people no longer eligible were NOT removed this time (a removal after an incomplete upload could drop people who are still eligible).${why}` };
    }
    return { action: 'FINISH', confirmation: 'FAILED', detail: `Google rejected the upload; the list was not changed.${why}` };
  }
  // SWEEPING
  if (outcome.status === 'SUCCESS') return { action: 'FINISH', confirmation: 'CONFIRMED', detail: 'Google confirmed the upload, and removed the people who are no longer eligible.' };
  return { action: 'FINISH', confirmation: 'FAILED', detail: `Google confirmed the upload, but removing the people who are no longer eligible did not succeed.${why}` };
}

/** What admin shows for a run's confirmation state (null = nothing to confirm). */
export function confirmationLabel(c: Confirmation | null | undefined): string | null {
  switch (c) {
    case 'WAITING': case 'SWEEPING': return 'Sent, waiting for Google';
    case 'CONFIRMED': return 'Confirmed by Google';
    case 'PARTIAL': return 'Partly accepted by Google';
    case 'FAILED': return 'Rejected by Google';
    case 'UNCONFIRMED': return 'Not confirmed by Google';
    default: return null;
  }
}
