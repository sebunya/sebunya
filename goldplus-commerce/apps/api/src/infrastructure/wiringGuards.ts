import { createHmac } from 'node:crypto';

/**
 * Small, testable guards used by the Registry wiring (2026-11 review).
 */

/** A positive number from an env value; empty, zero, negative or garbage gives the default. */
export function positiveNumberEnv(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? '').trim());
  return (raw ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The identity stored on a coupon redemption: HMAC-SHA256 under the identity
 * pepper (a bare SHA-256 of a phone can be reversed by brute force). Nothing
 * compares these hashes across rows (per-customer limits count by scope key in
 * the capacity ledger, first-order eligibility hashes the phone itself), so
 * older bare-SHA rows stay valid as they are.
 */
export function couponRedemptionIdentityHash(customerScopeKey: string, pepper: string): string {
  return createHmac('sha256', pepper).update(customerScopeKey).digest('hex');
}

/** One notification per played scratch card: the token id makes a second identical win its own message. */
export function drawNotifyKey(input: { userId: string; tokenId: string; label: string; points: number }): string {
  return `draw-notify:${input.userId}:${input.tokenId}:${input.label}:${input.points}`;
}

/** The Care Desk title quotes what Pesapal was asked for: the amount due (total less store credit). */
export function paidMismatchTitle(ref: string, paidUgx: number, amountDueUgx: number, totalUgx: number): string {
  const f = (n: number) => n.toLocaleString('en-US');
  const credit = totalUgx - amountDueUgx;
  return `Order ${ref} was paid UGX ${f(paidUgx)} but UGX ${f(amountDueUgx)} is now due`
    + (credit > 0 ? ` (total UGX ${f(totalUgx)} less UGX ${f(credit)} store credit)` : '');
}

/** Fire-and-forget with a catch: an unhandled rejection shuts the API down (server.ts). */
export function runDetached(work: Promise<unknown>, onError: (err: unknown) => void): void {
  work.catch((err) => {
    try { onError(err); } catch { /* the logger must not rethrow */ }
  });
}
