import { OrderStatus, PaymentStatus } from './Order';

/**
 * The order state machine (Slice 4). Pure domain.
 *
 * The transition rules used to live only inside the admin governance route, so
 * the domain's `transitionStatus` would happily move an order from `completed`
 * back to `received` or skip straight past payment — the entity had no state
 * machine at all. This is the single source of truth; the route now delegates to
 * it, and the entity enforces it, so an illegal transition cannot be persisted
 * from any caller.
 *
 * The allow-lists match the previously-enforced governance behaviour exactly,
 * plus the terminal states are now genuinely terminal.
 */
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  received: ['processing', 'cancelled'],
  pending_payment: ['processing', 'cancelled'],
  pending_owner_review: ['processing', 'cancelled'],
  // Location module stage 2: the delivery leg. `completed` stays reachable
  // directly for non-delivery closure (collection at the counter, historical
  // flows); dispatched orders resolve through a recorded delivery outcome.
  processing: ['dispatched', 'completed', 'cancelled'],
  dispatched: ['delivered', 'delivery_failed'],
  // A failed attempt is NOT terminal: re-dispatch for another attempt, close
  // out via completed (e.g. customer collected after a failed attempt), or
  // cancel. Every hop is ledgered by OrderTransitionService like any other.
  delivery_failed: ['dispatched', 'completed', 'cancelled'],
  delivered: [], // terminal — the success state failed-delivery metrics count against
  completed: [], // terminal
  cancelled: [], // terminal
  failed: [], // terminal — set internally by checkout/payment failure, not transitioned out of
};

export type OrderTransitionResult =
  | { allowed: true }
  | { allowed: false; code: 'ILLEGAL_TRANSITION' | 'UNPAID'; message: string };

/**
 * Whether an order may move `from → to`. The one contextual rule: an order
 * pending payment may only enter `processing` once payment is confirmed —
 * processing an unpaid order is the classic way stock ships for free.
 */
export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  ctx: { paymentStatus: PaymentStatus },
): OrderTransitionResult {
  if (from === to) {
    return { allowed: false, code: 'ILLEGAL_TRANSITION', message: `Order is already '${to}'.` };
  }
  if (!ALLOWED[from].includes(to)) {
    return {
      allowed: false,
      code: 'ILLEGAL_TRANSITION',
      message: `Operational transition from '${from}' to '${to}' is not allowed.`,
    };
  }
  if (from === 'pending_payment' && to === 'processing' && ctx.paymentStatus !== 'paid') {
    return {
      allowed: false,
      code: 'UNPAID',
      message: 'Cannot process an unpaid order that is pending payment.',
    };
  }
  return { allowed: true };
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ALLOWED[status].length === 0;
}
