/**
 * Which pickup points a customer may choose at checkout to COLLECT their order
 * (2026-10-16). ug_pickup_point holds two kinds of place: our own shops and
 * partner counters, where a customer collects for free, and carrier stages and
 * parcel offices upcountry (operator 'bus_parcel_office'), which are the far
 * end of a priced taxi or bus shipment. The second kind must never appear as a
 * free collection option in Kampala, so the checkout list and the zero-fee
 * pricing both go through this one rule.
 */
export const CARRIER_OPERATORS: readonly string[] = ['bus_parcel_office'];

export function isShopCollectionOperator(operator: string | null | undefined): boolean {
  const op = String(operator ?? '').trim().toLowerCase();
  return op.length > 0 && !CARRIER_OPERATORS.includes(op);
}
