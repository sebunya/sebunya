import { Context } from 'hono';
import {
  CART_CREDENTIAL_HEADER,
  CartCredentialClaims,
  CartKey,
  buildCartKeyring,
  verifyCartCredential,
} from '@goldplus/shared';
import { logger } from '../../../infrastructure/logging/logger';

/**
 * Verifies the BFF-issued cart credential. This layer NEVER mints one.
 *
 * The cart routes previously took a `cartId` from the request body or path and acted
 * on it with no authorization whatsoever. The id is a v4 UUID, so it is not
 * guessable — but the design rested on that secrecy, and the value travels where a
 * secret must not: it is the browser's `goldplus_cart_id` cookie, and on the read
 * route it is a URL PATH SEGMENT, so it reaches access logs, proxy logs, browser
 * history and Referer headers.
 *
 * Issuance belongs to the layer that owns the browser connection, for the same reason
 * checkout intent does: the API's `Set-Cookie` lands on the Astro server's fetch
 * response and never reaches the browser. So a missing or unusable credential is an
 * explicit typed refusal here, never a silently minted one — minting would turn "no
 * proof of ownership" into "a brand-new owner", which is not a smaller failure.
 */

export type CartResolution =
  | { ok: true; claims: CartCredentialClaims }
  | {
      ok: false;
      code:
        | 'CART_CREDENTIAL_REQUIRED'
        | 'CART_CREDENTIAL_EXPIRED'
        | 'CART_CREDENTIAL_INVALID'
        | 'CART_SESSION_UNAVAILABLE';
    };

/**
 * Accepted signing keys: current, then previous.
 *
 * Both are honoured during a rotation. A rotation that empties every shopper's cart
 * is a rotation nobody performs, so it would simply never happen and the key would
 * never change.
 */
export function cartKeys(): CartKey[] | null {
  const root = (process.env.CART_CREDENTIAL_SECRET || '').trim();
  // Falls back to JWT_SECRET but ALWAYS through the labelled derivation, so the cart
  // key stream is unrelated to the session-token and checkout-intent key streams even
  // when all three come from one root secret.
  const fallback = (process.env.JWT_SECRET || '').trim();
  const source = root || fallback;
  if (!source) return null;

  try {
    return buildCartKeyring({
      rootSecret: source,
      currentKeyId: process.env.CART_CREDENTIAL_KEY_ID,
      previousKeyId: process.env.CART_CREDENTIAL_PREVIOUS_KEY_ID,
    });
  } catch {
    // A secret too short or a malformed key id is a misconfiguration. Reported as
    // "no keys", which the caller turns into a refusal — never a fallback to an
    // unsigned identity.
    return null;
  }
}

/**
 * Resolves the caller's authority over a cart.
 *
 * `c.get('userId')` must already be populated from a VERIFIED bearer token by the
 * time this runs, because a USER-owned cart is cross-checked against it.
 */
export function resolveCartCredential(c: Context): CartResolution {
  const keys = cartKeys();
  if (!keys) return { ok: false, code: 'CART_SESSION_UNAVAILABLE' };

  const token = c.req.header(CART_CREDENTIAL_HEADER);
  if (!token) return { ok: false, code: 'CART_CREDENTIAL_REQUIRED' };

  const verified = verifyCartCredential(keys, token);

  if (verified.valid) {
    const claims = verified.claims;
    const sessionUserId = c.get('userId') as string | undefined;

    // A USER cart requires the matching verified session. The credential alone is a
    // bearer token; pairing it with the session means a captured credential is not
    // enough to reach a signed-in customer's cart.
    if (claims.ownerKind === 'USER') {
      if (!sessionUserId) return { ok: false, code: 'CART_CREDENTIAL_INVALID' };
      if (sessionUserId !== claims.ownerId) {
        logger.warn({ reason: 'USER_CART_SESSION_MISMATCH' }, 'CART_CREDENTIAL_REJECTED');
        return { ok: false, code: 'CART_CREDENTIAL_INVALID' };
      }
      return { ok: true, claims };
    }

    // A signed-in customer must not keep transacting under a guest cart: their next
    // order would be attributed to an anonymous principal, and their own cart would
    // appear to have lost its items.
    if (sessionUserId) {
      logger.warn({ reason: 'GUEST_CART_WITH_SESSION' }, 'CART_CREDENTIAL_REJECTED');
      return { ok: false, code: 'CART_CREDENTIAL_INVALID' };
    }

    return { ok: true, claims };
  }

  if (verified.reason === 'EXPIRED') return { ok: false, code: 'CART_CREDENTIAL_EXPIRED' };

  // The CALLER gets one collapsed code: distinguishing MALFORMED from BAD_SIGNATURE
  // from UNKNOWN_KEY hands them a forgery oracle. The OPERATOR needs the
  // distinction — a wave of BAD_SIGNATURE means the issuer and verifier disagree
  // about the key, which is a misconfiguration, while MALFORMED means a truncated or
  // rewritten header. Logged without the token, which is itself a credential.
  logger.warn(
    { reason: verified.reason, acceptedKeyIds: keys.map((k) => k.keyId) },
    'CART_CREDENTIAL_REJECTED',
  );
  return { ok: false, code: 'CART_CREDENTIAL_INVALID' };
}

/**
 * HTTP status for a refusal.
 *
 * 401 for every credential problem and 503 only for a server-side misconfiguration.
 * Deliberately never 403: 403 would mean "you are known and not allowed", which
 * distinguishes an existing cart from a missing one and tells a caller probing ids
 * which ones are real.
 */
export function cartRefusalStatus(
  code: Extract<CartResolution, { ok: false }>['code'],
): 401 | 503 {
  return code === 'CART_SESSION_UNAVAILABLE' ? 503 : 401;
}
