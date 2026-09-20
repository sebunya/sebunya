/**
 * The payment attempt state machine, made EXPLICIT (payments brief, 2026-08-06).
 *
 * Before this file the attempt statuses were string literals scattered across
 * the start, verify and settle paths — and the production data showed what that
 * costs: five attempts sat in `pending` from May to August, because `pending`
 * had no exit except a callback that only the provider could send. A state that
 * can be entered and never left is not a state, it is a trap.
 *
 * Every state below is either TERMINAL — named as such — or has a named exit
 * that does not depend on the provider choosing to call us:
 *
 *   not_started            -> pending (submit succeeded)
 *                          -> abandoned (poller: no provider transaction exists,
 *                             so there is nothing to ask and no money possible)
 *   pending                -> completed | failed | invalid | reversed
 *                             (provider truth, via callback, IPN or THE POLLER)
 *                          -> verification_pending | verification_failed
 *   verification_pending   -> same exits as pending (the poller retries)
 *   verification_failed    -> completed | failed | invalid | reversed
 *                             (ops re-verify; integrity mismatches need eyes)
 *   completed              -> reversed (a provider reversal or a refund)
 *   failed | invalid       -> completed | reversed, but ONLY on the provider's
 *                             own word: one tracking id can hold a declined
 *                             attempt and then a successful one
 *   abandoned              -> completed (same rule)
 *   reversed               TERMINAL
 *
 * The transition map is enforced at the single write path. An illegal move
 * throws rather than warns, because the last module's lesson was that a warning
 * on a money path is a log line nobody reads.
 */

export const PAYMENT_ATTEMPT_STATUSES = [
  'not_started',
  'pending',
  'verification_pending',
  'verification_failed',
  'completed',
  'failed',
  'invalid',
  'reversed',
  'abandoned',
] as const;

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export function isPaymentAttemptStatus(value: string): value is PaymentAttemptStatus {
  return (PAYMENT_ATTEMPT_STATUSES as readonly string[]).includes(value);
}

/** States from which no further movement is legal (except completed→reversed). */
export const TERMINAL_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  'failed',
  'invalid',
  'reversed',
  'abandoned',
];

/**
 * States the reconciliation poller must pick up: a live provider transaction
 * may exist and the provider holds truth we have not heard.
 */
export const POLLABLE_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  'pending',
  'verification_pending',
];

const TRANSITIONS: Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]> = {
  not_started: ['pending', 'abandoned'],
  pending: ['completed', 'failed', 'invalid', 'reversed', 'verification_pending', 'verification_failed'],
  verification_pending: ['completed', 'failed', 'invalid', 'reversed', 'verification_failed'],
  verification_failed: ['completed', 'failed', 'invalid', 'reversed'],
  // A completed payment can still be reversed by the provider, or refunded by us.
  completed: ['reversed'],
  failed: [],
  invalid: [],
  reversed: [],
  abandoned: [],
};

/**
 * Moves that only the PROVIDER may make, because only the provider knows
 * whether money moved.
 *
 * One provider transaction can carry more than one attempt by the customer: a
 * declined MTN PIN followed by a successful Airtel payment is ONE tracking id
 * with two outcomes. Our books recorded the decline and treated it as final, so
 * the success that followed could not be written — observed in production on
 * 2026-09-20 with the shop's first ever successful collection: PesaPal held
 * "Completed, UGX 4,000, confirmation 156914631189" while the order said
 * failed and unpaid. Money collected against an unfulfilled order is the one
 * outcome the payments brief calls unacceptable.
 *
 * Our own bookkeeping still may not make this move; it is legal only when the
 * provider's own status is the source (IPN, return leg or the poller).
 */
/**
 * One PesaPal tracking id can legitimately report, in order:
 *   0 INVALID (nothing paid yet) -> 2 FAILED (an instrument declined)
 *   -> 1 COMPLETED (another instrument paid) -> 3 REVERSED (money returned).
 * Any of those may be the FIRST thing we hear, and any may follow any other
 * while the page is live, so every non-money state must be able to reach every
 * later provider verdict. Only `reversed` is final: the money went back, and
 * that transaction is over.
 *
 * Verification always RE-READS the provider's current status rather than
 * trusting a notification body, so a late or duplicated notification cannot
 * drag a completed payment backwards — it re-reads "Completed" and self-loops.
 */
const PROVIDER_CONFIRMED_TRANSITIONS: Record<string, readonly PaymentAttemptStatus[]> = {
  failed: ['completed', 'invalid', 'reversed'],
  invalid: ['completed', 'failed', 'reversed'],
  abandoned: ['completed', 'failed', 'invalid', 'reversed'],
};

export function canTransitionAttempt(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
  options?: { providerConfirmed?: boolean },
): boolean {
  if (from === to) return true; // self-loop: re-stamping timestamps is legal
  if (TRANSITIONS[from]?.includes(to)) return true;
  return options?.providerConfirmed === true && (PROVIDER_CONFIRMED_TRANSITIONS[from]?.includes(to) ?? false);
}

/**
 * Assert a transition, throwing on an illegal one.
 *
 * The message names both states, because "invalid status" on a payment write is
 * exactly the kind of error text somebody greps for at 2am.
 */
export function assertAttemptTransition(from: string, to: string, options?: { providerConfirmed?: boolean }): void {
  if (!isPaymentAttemptStatus(to)) {
    throw new Error(`PAYMENT_STATE_UNKNOWN: "${to}" is not a payment attempt status.`);
  }
  // An unknown FROM (legacy value) may move anywhere legal-to-enter once, so a
  // vocabulary migration cannot brick existing rows; it may not stay unknown.
  if (!isPaymentAttemptStatus(from)) return;
  if (!canTransitionAttempt(from, to, options)) {
    const provider = PROVIDER_CONFIRMED_TRANSITIONS[from];
    throw new Error(
      `PAYMENT_STATE_ILLEGAL_TRANSITION: a payment attempt cannot move from "${from}" to "${to}". ` +
        `Legal exits from "${from}": ${TRANSITIONS[from].length ? TRANSITIONS[from].join(', ') : '(terminal)'}` +
        `${provider?.length ? `; with provider confirmation: ${provider.join(', ')}` : ''}.`,
    );
  }
}

/** Exposed for the exhaustiveness test: every non-terminal state must exit. */
export function legalExits(from: PaymentAttemptStatus): readonly PaymentAttemptStatus[] {
  return TRANSITIONS[from];
}
