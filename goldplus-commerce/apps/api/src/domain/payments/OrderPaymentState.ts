/**
 * The ORDER's payment status, made explicit — the same discipline the attempt
 * state machine has had since 2026-08-06, applied to the field that says
 * whether the shop has the customer's money.
 *
 * WHY THIS EXISTS. An order can hold SEVERAL payment attempts: a declined one
 * and, later, the one that paid. The provider notifies per TRANSACTION and
 * retries its notifications, so a late or duplicated notification about the
 * DECLINED sibling arrives after the order is already paid. The write path was
 * called `updateOrderPaymentStatusSafely` but guarded nothing, so that
 * notification would write `failed` over `paid`: an order the customer had
 * genuinely paid for, recorded as unpaid, with the money sitting in the
 * provider account. Discovered 2026-09-20 while reviewing the module after the
 * shop's first real collection (order GP-202609-0B3BA402).
 *
 * The rule money demands: `paid` is never withdrawn by anything except a
 * reversal, which is a fact about money moving BACK, not a fact about another
 * attempt failing.
 */

export const ORDER_PAYMENT_STATUSES = ['unpaid', 'failed', 'paid', 'reversed'] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

export function isOrderPaymentStatus(value: string): value is OrderPaymentStatus {
  return (ORDER_PAYMENT_STATUSES as readonly string[]).includes(value);
}

const TRANSITIONS: Record<OrderPaymentStatus, readonly OrderPaymentStatus[]> = {
  // Nothing collected yet: any outcome is still ahead.
  unpaid: ['paid', 'failed', 'reversed'],
  // An attempt failed. Another may still succeed — that is the normal shape of
  // a Ugandan mobile-money purchase — so this is not the end of the order.
  failed: ['paid', 'unpaid', 'reversed'],
  // The shop HAS the money. Only money going back changes that.
  paid: ['reversed'],
  // The money went back. That is the end of this order's payment story.
  reversed: [],
};

export function canTransitionOrderPayment(from: OrderPaymentStatus, to: OrderPaymentStatus): boolean {
  if (from === to) return true; // re-stamping the same truth is legal
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Decides what a write should do. A refused move is NOT an error: it is the
 * expected shape of a late notification about an attempt that no longer speaks
 * for the order, and throwing there would turn a normal provider retry into a
 * 500. The caller skips the write and says why.
 */
export function orderPaymentWriteDecision(
  from: string,
  to: string,
): { write: boolean; reason: string } {
  if (!isOrderPaymentStatus(to)) return { write: false, reason: `UNKNOWN_TARGET:${to}` };
  // An unrecognised current value (legacy row) may be corrected once.
  if (!isOrderPaymentStatus(from)) return { write: true, reason: 'UNKNOWN_CURRENT' };
  if (canTransitionOrderPayment(from, to)) return { write: true, reason: 'LEGAL' };
  return { write: false, reason: `REFUSED:${from}->${to}` };
}

/** Exposed for the exhaustiveness test: only `reversed` may be a dead end. */
export function legalOrderPaymentExits(from: OrderPaymentStatus): readonly OrderPaymentStatus[] {
  return TRANSITIONS[from];
}
