/**
 * Referrer hosts that are NOT an arrival from outside: the payment gateway
 * sending the shopper back after paying (PesaPal, and the card-scheme pages it
 * hands off to), and our own subdomains (www., api., metrics.). Treated as no
 * referrer by the attribution capture and the landing touch, the same way GA4's
 * "unwanted referrals" list works. Without this, paying by card overwrote the
 * shopper's real last touch (say, a Facebook ad) with pay.pesapal.com /
 * referral, and the next order was credited to the payment page.
 *
 * Mirrors PAYMENT_OR_SELF_HOST in apps/api/src/domain/measurement/Channels.ts,
 * the server-side safety net.
 */
const PAYMENT_HOST = /(^|\.)pesapal\.com$/i;

export function isInternalReferrerHost(host: string, selfHost: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (PAYMENT_HOST.test(h)) return true;
  const self = selfHost.toLowerCase().replace(/^www\./, '');
  return h === self || h.endsWith(`.${self}`);
}
