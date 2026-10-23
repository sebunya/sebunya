/**
 * Referrer hosts that are NOT an arrival from outside: the payment gateway
 * sending the shopper back after paying (PesaPal, and the card-scheme pages it
 * hands off to), and our own subdomains (www., api., metrics.). Treated as no
 * referrer by the attribution capture and the landing touch, the same way GA4's
 * "unwanted referrals" list works. Without this, paying by card overwrote the
 * shopper's real last touch (say, a Facebook ad) with pay.pesapal.com /
 * referral, and the next order was credited to the payment page.
 *
 * The rule lives in the one attribution rulebook (packages/shared/src/attribution/arrival.ts).
 */
export { isInternalReferrerHost } from '@goldplus/shared/src/attribution/arrival';
