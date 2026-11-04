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

/**
 * Baymard A6: the date each of the four steps was reached, from the API's tracking facts (null = not yet).
 * Index matches the stage index above.
 */
export interface TrackingFacts {
  placedAt?: string | null; confirmedAt?: string | null; dispatchedAt?: string | null; deliveredAt?: string | null;
  rider?: { name: string | null; carrier: string | null; method: string | null; estimatedDeliveryAt: string | null } | null;
}
export function stageDates(t: TrackingFacts | null | undefined): [string | null, string | null, string | null, string | null] {
  return [t?.placedAt ?? null, t?.confirmedAt ?? null, t?.dispatchedAt ?? null, t?.deliveredAt ?? null];
}
/** "4 Nov, 14:05" in Kampala time, or '' for nothing/invalid. */
export function formatStepDate(iso: string | null | undefined): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' });
}
/** Who has the parcel, in the customer's words: "With our rider Moses", "Sent by Link Bus", or ''. */
export function riderLine(t: TrackingFacts | null | undefined): string {
  const r = t?.rider;
  if (!r) return '';
  if (r.name) return `With our rider ${r.name}`;
  if (r.carrier) return `Sent by ${r.carrier}`;
  return '';
}

/** Whether the order reached the customer (returns and problem reports open then). Case-insensitive. */
export function orderReachedCustomer(orderStatus: unknown): boolean {
  return orderProgressStage(orderStatus) === 3;
}
