/**
 * Single source of truth for money formatting across the storefront.
 *
 * The ISO 4217 code is `UGX`. The `en-UG` locale's *symbol* for it is "USh",
 * so `Intl.NumberFormat('en-UG', {currency:'UGX'})` renders "USh …" — which is
 * why cart/checkout disagreed with the header. We render the CODE, once, here:
 * `UGX` + non-breaking space + grouped digits, no decimals. Matches /^UGX\u00A0[\d,]+$/.
 */
export function formatUgx(value: unknown): string {
  const n = Math.round(Number(value) || 0);
  return `UGX\u00A0${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`;
}
