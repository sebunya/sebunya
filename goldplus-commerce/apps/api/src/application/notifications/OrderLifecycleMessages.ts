/**
 * Which customer message an order lifecycle move sends (owner decision
 * 2026-09-24: "send COD customers the same transactional confirmation /
 * dispatch / delivery / cancel SMS as online payers").
 *
 * Before this, the only customer order messages ever enqueued were the two
 * online-payment outcomes. A cash-on-delivery guest — the default way to pay —
 * got no copy of their order reference anywhere but the checkout screen, so
 * /track-order was useless to them, and a cancelled order was never
 * mentioned. The templates were written, classified TRANSACTIONAL and wired
 * to the router; nothing produced them.
 *
 * Every message goes out at most once per order and template (the outbox
 * idempotency key), and CUSTOMER_ORDER_MESSAGES_LIVE=false stops them all.
 */
export type OrderLifecycleTemplate = 'ORDER_RECEIVED_UNPAID' | 'ORDER_DISPATCHED' | 'ORDER_FULFILLMENT_COMPLETED' | 'ORDER_CANCELLED_BY_SHOP';

export function customerMessageForTransition(toStatus: string, actorType: string | null | undefined): OrderLifecycleTemplate | null {
  if (toStatus === 'dispatched') return 'ORDER_DISPATCHED';
  // "Has been delivered" is true only of a delivery; a counter collection
  // (processing → completed) is not one.
  if (toStatus === 'delivered') return 'ORDER_FULFILLMENT_COMPLETED';
  // A customer who cancelled their own order does not need telling.
  if (toStatus === 'cancelled' && actorType !== 'customer') return 'ORDER_CANCELLED_BY_SHOP';
  return null;
}

/**
 * The order confirmation for an order that is not paid online. Online payers
 * get ORDER_PAYMENT_SUCCESS when the money lands; a cash-on-delivery order has
 * no such moment, so it is confirmed when it is placed.
 */
export function confirmationForPlacedOrder(paymentMethod: string | null | undefined): OrderLifecycleTemplate | null {
  return paymentMethod === 'offline' ? 'ORDER_RECEIVED_UNPAID' : null;
}
