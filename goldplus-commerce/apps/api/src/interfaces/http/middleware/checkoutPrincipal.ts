import { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { Registry } from '../../../infrastructure/Registry';
import {
  CheckoutPrincipal,
  GUEST_PRINCIPAL_TTL_SECONDS,
  issueGuestPrincipal,
  verifyGuestPrincipal,
} from '../../../domain/commerce/CheckoutPrincipal';

/**
 * Resolves the trusted checkout principal.
 *
 * Checkout ownership used to be derived from the email or phone in the request
 * body. Those are caller-supplied, so they are not an authorization boundary:
 * anyone could adopt any identity by typing it. A principal has to be something
 * the caller cannot mint.
 *
 * Authenticated customers use their server-side user id. Guests get a signed,
 * expiring, high-entropy cookie value issued by this server — so a fabricated or
 * tampered cookie is rejected rather than believed, and a guest cannot establish
 * a principal merely by posting JSON.
 */

export const CHECKOUT_PRINCIPAL_COOKIE = 'gp_checkout_principal';

export type PrincipalResolution =
  | { ok: true; principal: CheckoutPrincipal; issued: boolean }
  | { ok: false; reason: 'SECRET_NOT_CONFIGURED' | 'PRINCIPAL_EXPIRED' };

function secret(): string {
  // Reuses the existing signing secret rather than adding another key for an
  // operator to rotate, lose, or leave unset. If it is missing, authentication
  // is already broken and failing closed here is consistent with that.
  return (process.env.CHECKOUT_PRINCIPAL_SECRET || process.env.JWT_SECRET || '').trim();
}

/**
 * Returns the principal for this request, minting a guest one if needed.
 *
 * `issued` tells the caller a fresh cookie was set, which matters because a
 * newly-issued principal cannot own any earlier operation — so a replay lookup
 * against it must find nothing rather than being treated as a lost session.
 */
export function resolveCheckoutPrincipal(c: Context): PrincipalResolution {
  const key = secret();
  if (!key) return { ok: false, reason: 'SECRET_NOT_CONFIGURED' };

  // An authenticated session always wins: a signed-in customer must not be
  // silently downgraded to a guest identity by a stale cookie.
  const userId = c.get('userId') as string | undefined;
  if (userId) {
    return { ok: true, principal: { kind: 'USER', id: userId }, issued: false };
  }

  const existing = getCookie(c, CHECKOUT_PRINCIPAL_COOKIE);
  if (existing) {
    const verified = verifyGuestPrincipal(key, existing);
    if (verified.valid) {
      return { ok: true, principal: { kind: 'GUEST', id: verified.principalId }, issued: false };
    }
    // A tampered or forged cookie is replaced rather than reported: telling the
    // caller which of MALFORMED / BAD_SIGNATURE / EXPIRED occurred hands them a
    // forgery oracle. An expired one is likewise just re-issued — the customer
    // simply starts a new checkout intent.
  }

  const minted = issueGuestPrincipal(key);
  setCookie(c, CHECKOUT_PRINCIPAL_COOKIE, minted.token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_PRINCIPAL_TTL_SECONDS,
  });
  return { ok: true, principal: { kind: 'GUEST', id: minted.principalId }, issued: true };
}

/** Registry accessor kept here so routes do not reach into infrastructure. */
export function checkoutIdempotencyRepo() {
  return Registry.getInstance().checkoutIdempotencyRepo;
}
