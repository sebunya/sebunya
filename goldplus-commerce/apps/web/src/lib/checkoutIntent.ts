import type { AstroCookies } from 'astro';
import {
  CHECKOUT_INTENT_HEADER,
  CHECKOUT_INTENT_TTL_SECONDS,
  checkoutIntentCookieName,
  buildIntentKeyring,
  issueCheckoutIntent,
  verifyCheckoutIntent,
  type IntentKey,
} from '@goldplus/shared';

/**
 * The storefront acts as the Backend for Frontend for checkout identity.
 *
 * WHY IT MUST BE HERE AND NOT IN THE API
 * The real path is browser → Astro SSR → server-side fetch → Commerce API. A
 * `Set-Cookie` from the API lands on the Astro server's fetch response and never
 * reaches the browser, and the browser's `Cookie` header never reaches the API.
 * An API-minted guest cookie is therefore not a browser identity at all: every
 * request would mint a fresh one, so a retry would get a NEW identity and the
 * idempotency claim could never match.
 *
 * Only the layer holding the browser connection can own the cookie. Astro issues
 * and stores it; the API verifies the forwarded token and never mints.
 */

const isProduction = () => import.meta.env.PROD === true;

function keys(): IntentKey[] | null {
  const root = (
    import.meta.env.CHECKOUT_INTENT_SECRET ||
    process.env.CHECKOUT_INTENT_SECRET ||
    import.meta.env.JWT_SECRET ||
    process.env.JWT_SECRET ||
    ''
  ).trim();
  if (!root) return null;

  // The SAME builder the API verifies with. Assembling the keyring twice is how an
  // issuer and a verifier drift apart, and the symptom is every customer being
  // unable to check out with nothing naming the rotation as the cause.
  try {
    return buildIntentKeyring({
      rootSecret: root,
      currentKeyId: import.meta.env.CHECKOUT_INTENT_KEY_ID || process.env.CHECKOUT_INTENT_KEY_ID,
      previousKeyId:
        import.meta.env.CHECKOUT_INTENT_PREVIOUS_KEY_ID ||
        process.env.CHECKOUT_INTENT_PREVIOUS_KEY_ID,
    });
  } catch {
    // Misconfigured rather than absent. Returning null makes the page refuse, which
    // is correct: minting under a weak key would produce tokens the API is right to
    // reject, and issuing them anyway would look like a working checkout.
    return null;
  }
}

export interface ResolvedIntent {
  token: string;
  /** True when this render minted a new intent rather than reusing one. */
  fresh: boolean;
}

/**
 * Returns the intent for this checkout, reusing the existing one where valid.
 *
 * The page previously rendered `crypto.randomUUID()` into a hidden field on every
 * render. That protects a same-render double-click and nothing else: a failed POST
 * followed by a re-render, a refresh, a back-navigation, a mobile reconnect or a
 * payment return each produced a NEW key and therefore a NEW operation. Reusing
 * the cookie is what makes those retries collapse onto one order.
 *
 * A deliberate second purchase gets a new intent because the previous one is
 * consumed on completion (`clearCheckoutIntent`), not because the page rendered.
 */
export function resolveCheckoutIntent(
  cookies: AstroCookies,
  authenticatedUserId?: string | null,
): ResolvedIntent | null {
  const keyList = keys();
  if (!keyList) return null;

  const name = checkoutIntentCookieName(isProduction());
  const existing = cookies.get(name)?.value;

  if (existing) {
    const verified = verifyCheckoutIntent(keyList, existing);
    if (verified.valid) {
      const claims = verified.claims;
      // A signed-in customer must not keep transacting under a guest intent, and
      // a guest must not inherit a previous user's intent from a shared browser.
      const matches = authenticatedUserId
        ? claims.kind === 'USER' && claims.principalId === authenticatedUserId
        : claims.kind === 'GUEST';
      if (matches) return { token: existing, fresh: false };
    }
    // Invalid, expired, or belonging to a different principal: replaced here in
    // the render flow, which is the only place minting is allowed.
  }

  const issued = issueCheckoutIntent({
    key: keyList[0],
    kind: authenticatedUserId ? 'USER' : 'GUEST',
    userId: authenticatedUserId ?? undefined,
  });

  cookies.set(name, issued.token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    // __Host- requires Path=/ and no Domain. Both are required for the prefix to
    // be honoured, and the prefix is what stops a sibling subdomain setting it.
    path: '/',
    maxAge: CHECKOUT_INTENT_TTL_SECONDS,
  });

  return { token: issued.token, fresh: true };
}

/**
 * Consumes the intent after a completed order.
 *
 * This is what makes the NEXT checkout a genuinely new operation, rather than
 * relying on the page to invent a new key each render.
 */
export function clearCheckoutIntent(cookies: AstroCookies): void {
  cookies.delete(checkoutIntentCookieName(isProduction()), { path: '/' });
}

export { CHECKOUT_INTENT_HEADER };
