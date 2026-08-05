/**
 * The quote commitment (brief PART 5).
 *
 * A fee quoted at checkout is FIXED. It may change only for one of the five
 * reasons below, only with the customer's agreement above the absorption
 * threshold, and never by a rider at the door.
 *
 * The list is closed on purpose. "The rider covered more ground than expected"
 * is not on it and never will be: that is a modelling error, it goes to
 * calibration, and GoldPlus absorbs it. Adding a reason here is a deliberate
 * act, and `applyVariance` refuses anything not in the list rather than
 * trusting the caller.
 */

export const VARIANCE_REASONS = [
  'ADDRESS_CHANGED_BY_CUSTOMER',
  /** Landmark, pin or ops review places it in a different area or band —
   *  including anything resolved through a name collision. */
  'AREA_MISMATCH_ON_RESOLUTION',
  /** Turns out to need water access, or is unserviceable. */
  'ACCESS_MODE_DIFFERENT',
  /** Attributable to the address or the recipient, not to us. */
  'REDELIVERY_AFTER_FAILED_ATTEMPT',
  /** Anything else. A written reason is mandatory. */
  'MANUAL_ADJUSTMENT_BY_OPS',
] as const;

export type VarianceReason = (typeof VARIANCE_REASONS)[number];

export function isVarianceReason(value: string): value is VarianceReason {
  return (VARIANCE_REASONS as readonly string[]).includes(value);
}

export type VarianceRefusal =
  | 'REASON_NOT_PERMITTED'
  | 'REASON_REQUIRES_NOTE'
  | 'ORDER_ALREADY_HANDED_OVER'
  | 'NO_CHANGE'
  | 'THRESHOLD_NOT_CONFIGURED';

export type VarianceDisposition =
  /** Inside the threshold: GoldPlus absorbs it, the customer is not contacted. */
  | { kind: 'absorbed'; deltaUgx: number }
  /** Above it: ops must obtain agreement BEFORE dispatch or redelivery. */
  | { kind: 'needs_agreement'; deltaUgx: number };

export interface VarianceThreshold {
  /** Absolute shillings. Null means unset. */
  absoluteUgx: number | null;
  /** Share of the original fee, in basis points. Null means unset. */
  shareBps: number | null;
}

export interface VarianceInput {
  reason: string;
  oldFeeUgx: number;
  newFeeUgx: number;
  note: string | null;
  /** Once the goods are with the customer, the amount is settled. */
  handedOver: boolean;
  threshold: VarianceThreshold;
}

export type VarianceDecision =
  | { ok: true; reason: VarianceReason; disposition: VarianceDisposition }
  | { ok: false; refusal: VarianceRefusal; message: string };

/**
 * Decide whether a fee change is permitted, and whether it needs the customer's
 * agreement.
 *
 * Pure. It does not write anything — the caller records old fee, new fee,
 * reason, actor, timestamp and agreement to the order audit, because no
 * variance is ever silent.
 */
export function decideVariance(input: VarianceInput): VarianceDecision {
  if (!isVarianceReason(input.reason)) {
    return {
      ok: false,
      refusal: 'REASON_NOT_PERMITTED',
      message: `"${input.reason}" is not a permitted reason to change a placed fee. A rider covering more ground than predicted is a modelling error, which GoldPlus absorbs.`,
    };
  }
  // The one reason that is a catch-all must explain itself.
  if (input.reason === 'MANUAL_ADJUSTMENT_BY_OPS' && (!input.note || input.note.trim().length < 10)) {
    return {
      ok: false,
      refusal: 'REASON_REQUIRES_NOTE',
      message: 'A manual adjustment needs a written reason of at least 10 characters.',
    };
  }
  if (input.handedOver) {
    return {
      ok: false,
      refusal: 'ORDER_ALREADY_HANDED_OVER',
      message: 'The goods are already with the customer. The amount is settled and cannot change.',
    };
  }
  const delta = input.newFeeUgx - input.oldFeeUgx;
  if (delta === 0) {
    return { ok: false, refusal: 'NO_CHANGE', message: 'The fee is unchanged.' };
  }
  // A REDUCTION always favours the customer, so it never needs their agreement
  // and is never withheld for want of a threshold.
  if (delta < 0) {
    return { ok: true, reason: input.reason, disposition: { kind: 'absorbed', deltaUgx: delta } };
  }
  const { absoluteUgx, shareBps } = input.threshold;
  if (absoluteUgx === null && shareBps === null) {
    // Unset means unset. Rather than absorb an unbounded amount or charge
    // without asking, refuse and make the missing decision visible.
    return {
      ok: false,
      refusal: 'THRESHOLD_NOT_CONFIGURED',
      message: 'The absorption threshold has not been set, so it cannot be decided whether this change needs the customer’s agreement.',
    };
  }
  const withinAbsolute = absoluteUgx !== null && delta <= absoluteUgx;
  const withinShare = shareBps !== null && input.oldFeeUgx > 0 && delta * 10_000 <= input.oldFeeUgx * shareBps;
  // "Whichever of the two thresholds is reached first" — so an increase is
  // absorbed only while it is inside EVERY configured threshold.
  const configured = [absoluteUgx !== null ? withinAbsolute : null, shareBps !== null ? withinShare : null].filter(
    (v): v is boolean => v !== null,
  );
  const absorbed = configured.every(Boolean);
  return {
    ok: true,
    reason: input.reason,
    disposition: absorbed ? { kind: 'absorbed', deltaUgx: delta } : { kind: 'needs_agreement', deltaUgx: delta },
  };
}

/**
 * What the rider is told to collect.
 *
 * Always the order total, and nothing else. A rider reporting a different
 * figure is a note for ops, never a change — so this takes no rider input at
 * all, which is the strongest form the control can take.
 */
export function riderCollectionAmount(order: {
  paymentStatus: string;
  totalUgx: number;
}): { collect: number; label: string } {
  if (order.paymentStatus === 'paid') return { collect: 0, label: 'PAID — collect nothing' };
  return { collect: order.totalUgx, label: `COLLECT ON DELIVERY: UGX ${order.totalUgx.toLocaleString('en-UG')}` };
}
