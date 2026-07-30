import type { AstroCookies } from 'astro';
import { randomUUID } from 'node:crypto';
import {
  CART_CREDENTIAL_HEADER,
  CART_CREDENTIAL_TTL_SECONDS,
  buildCartKeyring,
  cartCredentialCookieName,
  issueCartCredential,
  verifyCartCredential,
  type CartKey,
} from '@goldplus/shared';

/**
 * The storefront is the Backend for Frontend for cart identity, for the same reason it
 * is for checkout identity: the API's `Set-Cookie` lands on this server's fetch
 * response and never reaches the browser, so only the layer holding the browser
 * connection can own the cookie.
 *
 * WHAT THIS REPLACES
 * The cart id lived in a plain `goldplus_cart_id` cookie and was sent to the API as a
 * body field or a URL path segment. The API accepted it with no verification, so
 * knowing an id was full authority over that cart — and the id travelled through
 * access logs, proxy logs, browser history and Referer headers. The credential is
 * signed, so the id alone is no longer sufficient, and it names an owner so a
 * signed-in customer's cart cannot be reached by a guest credential.
 */

const isProduction = () => import.meta.env.PROD === true;

function keys(): CartKey[] | null {
  const root = (
    import.meta.env.CART_CREDENTIAL_SECRET ||
    process.env.CART_CREDENTIAL_SECRET ||
    import.meta.env.JWT_SECRET ||
    process.env.JWT_SECRET ||
    ''
  ).trim();
  if (!root) return null;

  // The SAME builder the API verifies with. Assembling the ring twice is how an issuer
  // and a verifier drift apart, and the symptom is every shopper losing their basket
  // with nothing naming the rotation as the cause.
  try {
    return buildCartKeyring({
      rootSecret: root,
      currentKeyId: import.meta.env.CART_CREDENTIAL_KEY_ID || process.env.CART_CREDENTIAL_KEY_ID,
      previousKeyId:
        import.meta.env.CART_CREDENTIAL_PREVIOUS_KEY_ID ||
        process.env.CART_CREDENTIAL_PREVIOUS_KEY_ID,
    });
  } catch {
    // Misconfigured rather than absent. Returning null makes the caller degrade to a
    // local-only basket instead of issuing tokens the API is right to reject.
    return null;
  }
}

export interface ResolvedCart {
  token: string;
  cartId: string;
  /** True when this render minted a new credential rather than reusing one. */
  fresh: boolean;
}

/**
 * Returns the cart credential for this browser, reusing the existing one where valid.
 *
 * A credential is replaced — not merely rejected — when the signed-in identity no
 * longer matches it. Otherwise a customer who signs in would keep transacting under
 * their guest basket, and a guest on a shared browser would inherit the previous
 * user's.
 *
 * The cart id is generated HERE and carried inside the signed claims, so the browser
 * never supplies one. That is what stops a caller naming another cart.
 */
export function resolveCartCredential(
  cookies: AstroCookies,
  authenticatedUserId?: string | null,
): ResolvedCart | null {
  const keyList = keys();
  if (!keyList) return null;

  const name = cartCredentialCookieName(isProduction());
  const existing = cookies.get(name)?.value;

  if (existing) {
    const verified = verifyCartCredential(keyList, existing);
    if (verified.valid) {
      const claims = verified.claims;
      const matches = authenticatedUserId
        ? claims.ownerKind === 'USER' && claims.ownerId === authenticatedUserId
        : claims.ownerKind === 'GUEST';
      if (matches) return { token: existing, cartId: claims.cartId, fresh: false };
    }
  }

  // A new basket. The guest owner id is random and unguessable rather than derived
  // from anything about the request: deriving it from an IP or a user agent would make
  // two shoppers behind one NAT share a basket.
  const cartId = randomUUID();
  const issued = issueCartCredential({
    key: keyList[0],
    cartId,
    ownerKind: authenticatedUserId ? 'USER' : 'GUEST',
    ownerId: authenticatedUserId ?? randomUUID(),
  });

  cookies.set(name, issued.token, {
    httpOnly: true,
    secure: isProduction(),
    // Lax, not Strict: a customer following a link to a product page must still have
    // their basket. The cross-site protection for MUTATIONS is the origin check, which
    // does not depend on the cookie policy.
    sameSite: 'lax',
    // __Host- requires Path=/ and no Domain. Both are required for the prefix to be
    // honoured, and the prefix is what stops a sibling subdomain setting it.
    path: '/',
    maxAge: CART_CREDENTIAL_TTL_SECONDS,
  });

  return { token: issued.token, cartId, fresh: true };
}

/** Discards the basket credential, e.g. after a completed order. */
export function clearCartCredential(cookies: AstroCookies): void {
  cookies.delete(cartCredentialCookieName(isProduction()), { path: '/' });
}

export { CART_CREDENTIAL_HEADER };
