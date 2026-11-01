/**
 * Which of the four customer-facing stages an order is at: 0 Order placed,
 * 1 Confirmed & preparing, 2 Dispatched, 3 Delivered. ONE mapping for
 * /track-order and the signed-in /orders/:id page, which used to disagree:
 * the account page put an order still waiting for the owner's review at
 * "Confirmed & preparing" while its own badge said "Being checked".
 *
 * pending_owner_review is a wholesale/corporate order our team has NOT yet
 * confirmed: it is still at "placed". Case-insensitive.
 */
export function orderProgressStage(orderStatus: unknown): 0 | 1 | 2 | 3 {
  const s = String(orderStatus ?? '').toLowerCase();
  if (s === 'delivered' || s === 'completed') return 3;
  if (s === 'dispatched' || s === 'delivery_failed') return 2;
  if (s === 'processing') return 1;
  return 0; // received, pending_owner_review, pending_payment, failed, cancelled (pre-dispatch)
}

/** Whether the order reached the customer (returns and problem reports open then). Case-insensitive. */
export function orderReachedCustomer(orderStatus: unknown): boolean {
  return orderProgressStage(orderStatus) === 3;
}
