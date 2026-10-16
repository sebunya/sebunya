/**
 * Keep the customer on shopgoldplus.com while they pay (2026-10-16).
 *
 * The payment start returns Pesapal's payment-page URL. Instead of sending the
 * browser there, checkout sends it to our own /checkout/pay page, which shows
 * the order and embeds that page in a frame. Pesapal's page allows framing, our
 * CSP allows pay.pesapal.com in frame-src, and the account's redirect_mode
 * (TOP_WINDOW) returns the WHOLE window to our callback when payment finishes.
 *
 * Only Pesapal's own hosts may be framed: anything else falls back to a plain
 * redirect, so this page can never be used to frame an arbitrary site.
 */
import { mobileMoneyNetworkFor } from '@goldplus/shared';

const ALLOWED_HOSTS = new Set(['pay.pesapal.com', 'cybqa.pesapal.com']);

export function isFramablePaymentUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Where checkout sends the customer: our page when the URL is Pesapal's, else Pesapal directly. */
export function onSitePaymentPath(input: { redirectUrl: string; orderNumber: string; phone?: string | null }): string {
  if (!isFramablePaymentUrl(input.redirectUrl)) return input.redirectUrl;
  const q = new URLSearchParams({ ref: input.orderNumber, u: input.redirectUrl });
  const net = mobileMoneyNetworkFor(input.phone ?? null);
  if (net) q.set('net', net);
  return `/checkout/pay?${q.toString()}`;
}
