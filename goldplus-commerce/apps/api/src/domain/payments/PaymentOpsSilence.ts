/**
 * The two stock-safety sweeps (reservation expiry, unpaid-order abandonment)
 * each report `skipped` when their operator window is not configured. Until
 * 2026-09-12 that outcome was never logged: production ran both every ten
 * minutes for weeks with payments_ops_config EMPTY, so no reservation ever
 * expired and no unpaid order was ever abandoned — one unit of stock had been
 * held for an order with no payment attempt since 29 August — and nothing
 * said so. A sweep that silently does nothing is indistinguishable from one
 * that works. Pure, so it can be tested without the ticker.
 */
export function describeSkippedSweeps(input: {
  reservations: { skipped: 'ttl_not_configured' | null };
  abandonment: { skipped: 'window_not_configured' | null };
}): string | null {
  const parts: string[] = [];
  if (input.reservations.skipped) {
    parts.push('reservation_ttl_hours is not set, so stock reserved by unpaid orders is NEVER released automatically');
  }
  if (input.abandonment.skipped) {
    parts.push('order_abandonment_hours is not set, so unpaid orders are NEVER abandoned automatically');
  }
  if (parts.length === 0) return null;
  return `[payment-ops] SWEEPS ARE OFF — ${parts.join('; ')}. Set them in payments_ops_config.`;
}
