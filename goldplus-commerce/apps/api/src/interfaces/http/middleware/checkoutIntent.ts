import { Context } from 'hono';
import {
  CHECKOUT_INTENT_HEADER,
  CheckoutIntentClaims,
  IntentKey,
  deriveIntentKey,
  verifyCheckoutIntent,
} from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';

/**
 * Verifies the BFF-issued checkout intent. This layer NEVER mints one.
 *
 * The previous implementation minted a guest principal inside the order mutation
 * whenever the cookie was missing, expired or unsigned. In the real SSR topology
 * that was every single request — the API's Set-Cookie lands on the Astro
 * server's fetch response, not the browser — so each retry received a fresh
 * identity and the idempotency claim could never match. Worse, silent minting
 * turns a *lost* identity into a *new operation*, which is precisely how a lost
 * HTTP response becomes a duplicate order.
 *
 * So a missing or unusable intent is now an explicit, typed refusal. Issuing and
 * rotating an intent belongs to the bootstrap flow that owns the browser.
 */

export type IntentResolution =
  | { ok: true; claims: CheckoutIntentClaims }
  | {
      ok: false;
      code:
        | 'CHECKOUT_INTENT_REQUIRED'
        | 'CHECKOUT_INTENT_EXPIRED'
        | 'CHECKOUT_INTENT_INVALID'
        | 'CHECKOUT_SESSION_UNAVAILABLE';
    };

/**
 * Accepted signing keys: current, then previous.
 *
 * Both are accepted during a rotation so an in-flight checkout is not
 * invalidated mid-payment. A rotation that logs out every mid-checkout customer
 * is a rotation nobody ever performs.
 */
export function intentKeys(): IntentKey[] | null {
  const root = (process.env.CHECKOUT_INTENT_SECRET || '').trim();
  // Falls back to JWT_SECRET but ALWAYS through the labelled derivation, so the
  // intent key stream is unrelated to the session-token key stream even when
  // both come from one root secret.
  const fallback = (process.env.JWT_SECRET || '').trim();
  const source = root || fallback;
  if (!source) return null;

  const currentId = (process.env.CHECKOUT_INTENT_KEY_ID || '1').trim();
  const previousId = (process.env.CHECKOUT_INTENT_PREVIOUS_KEY_ID || '').trim();

  const keys = [deriveIntentKey(source, currentId)];
  if (previousId && previousId !== currentId) keys.push(deriveIntentKey(source, previousId));
  return keys;
}

export function resolveCheckoutIntent(c: Context): IntentResolution {
  const keys = intentKeys();
  if (!keys) return { ok: false, code: 'CHECKOUT_SESSION_UNAVAILABLE' };

  const token = c.req.header(CHECKOUT_INTENT_HEADER);
  if (!token) return { ok: false, code: 'CHECKOUT_INTENT_REQUIRED' };

  const verified = verifyCheckoutIntent(keys, token);
  if (verified.valid) {
    // An authenticated session must win over any intent claiming to be a guest.
    // Otherwise a stale guest cookie would let a signed-in customer's order be
    // attributed to an anonymous principal.
    const verifiedUserId = c.get('userId') as string | undefined;
    if (verifiedUserId && verified.claims.kind === 'GUEST') {
      return { ok: false, code: 'CHECKOUT_INTENT_INVALID' };
    }
    if (verifiedUserId && verified.claims.principalId !== verifiedUserId) {
      // A USER intent belonging to somebody else.
      return { ok: false, code: 'CHECKOUT_INTENT_INVALID' };
    }
    return { ok: true, claims: verified.claims };
  }

  if (verified.reason === 'EXPIRED') return { ok: false, code: 'CHECKOUT_INTENT_EXPIRED' };
  // MALFORMED, BAD_SIGNATURE and UNKNOWN_KEY collapse to one code: telling the
  // caller which one occurred hands them a forgery oracle.
  return { ok: false, code: 'CHECKOUT_INTENT_INVALID' };
}

/**
 * Verified optional authentication.
 *
 * Sets `userId` only from a cryptographically verified bearer token. A
 * caller-supplied `x-user-id` header is never consulted — it is proof of nothing
 * — and an invalid token is treated as absent rather than trusted, so a
 * malformed session degrades to guest instead of authenticating anybody.
 */
export async function applyOptionalCustomerSession(c: Context): Promise<void> {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  if (!token) return;
  try {
    const verified = await Registry.getInstance().tokenSigner.verify(token);
    if (verified) {
      c.set('userId', verified.subject);
      c.set('userEmail', verified.email);
    }
  } catch {
    // An unverifiable token means "not authenticated", never "authenticated as
    // whoever the token claims to be".
  }
}
