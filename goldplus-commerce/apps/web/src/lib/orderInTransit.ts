/**
 * True when an order status means the parcel is on its way to the shopper.
 * A finished ('delivered'), failed ('delivery_failed') or not-yet-sent
 * ('ready_for_dispatch') order is not in transit, so the header must not
 * tell the shopper about a parcel on its way.
 */
export function isOrderInTransit(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s) return false;
  if (/delivered|fail|cancel|refund|return|ready_for/.test(s)) return false;
  return /^(out_for_delivery|dispatched|in_transit|shipped|shipping)$/.test(s);
}
