/**
 * Single source of truth for money formatting across the storefront.
 *
 * The ISO 4217 code is `UGX`. The `en-UG` locale's *symbol* for it is "USh",
 * so `Intl.NumberFormat('en-UG', {currency:'UGX'})` renders "USh …" — which is
 * why cart/checkout disagreed with the header. We render the CODE, once, here:
 * `UGX` + non-breaking space + grouped digits, no decimals. Matches /^UGX\u00A0[\d,]+$/.
 */
// Direct path, not the package root: this file runs in the browser too, and the root pulls in node:crypto.
import { formatMoney } from '@goldplus/shared/src/markets';

/** The Uganda case of the shared market formatter (packages/shared/src/markets): same output as before. */
export function formatUgx(value: unknown): string {
  return formatMoney(value, 'UGX');
}

/**
 * The receipt's Delivery cell. A 0 fee is "Free" only when the fee was confirmed (a waiver, or collection); an
 * address the quote could not price is stored as 0 UNCONFIRMED and the team agrees the fee by phone, so it must
 * never read as free delivery (visibility gaps N8). An unknown flag (an older API) keeps the old reading.
 */
export function deliveryFeeCell(feeUgx: number, confirmed: boolean | null | undefined): string {
  if (feeUgx > 0) return formatUgx(feeUgx);
  return confirmed === false ? 'To be agreed by phone' : 'Free';
}
