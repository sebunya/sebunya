import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Cart credential — proof that the caller may act on a specific cart.
 *
 * WHAT WAS WRONG
 * Every cart route took a `cartId` straight from the request body or path and acted
 * on it with no authorization of any kind:
 *
 *   POST /commerce/cart/add     body.cartId  -> add items to any cart
 *   POST /commerce/cart/update  body.cartId  -> change quantities in any cart
 *   POST /commerce/cart/remove  body.cartId  -> empty any cart
 *   GET  /commerce/carts/:id                 -> read any cart's contents
 *
 * The id is a v4 UUID, so it is not guessable — but the whole design rested on that
 * secrecy, and the value travels where secrets must not: it is the browser's
 * `goldplus_cart_id` cookie, it appears in a URL PATH on the read route (so it lands
 * in access logs, proxy logs, browser history and Referer headers), and the
 * storefront's own admin lookup page accepts it as typed input. "Unguessable
 * identifier in a URL" is not an authorization boundary.
 *
 * THE FIX
 * The same shape that already works for checkout intent: the layer that owns the
 * browser connection (Astro) issues a signed credential and stores it; the API
 * verifies it and never mints one. Knowing a cart id is no longer sufficient,
 * because the id alone carries no signature.
 *
 * The credential also BINDS AN OWNER. A cart claimed by a signed-in customer can
 * only be acted on by a credential naming that user, which the API cross-checks
 * against the verified session — so a stale guest credential cannot reach a user's
 * cart, and one user's credential cannot reach another's.
 *
 * KEY SEPARATION
 * A distinct KDF label from the checkout intent. Reusing one key across two purposes
 * would let a cart credential be presented as a checkout intent, or the reverse;
 * the label makes the two key streams unrelated even when both derive from one root
 * secret.
 */

const KDF_LABEL = 'goldplus-cart-credential-v1';
const TOKEN_VERSION = 'v1';

/**
 * How long a credential is honoured.
 *
 * Longer than a checkout intent because a cart legitimately persists across days of
 * browsing, and a customer whose credential expires mid-session loses their basket.
 * Bounded rather than eternal so a credential captured from an old log stops working.
 */
export const CART_CREDENTIAL_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Header carrying the credential from the BFF to the API. */
export const CART_CREDENTIAL_HEADER = 'x-goldplus-cart';

/** Browser cookie holding the credential. __Host- prefix in production. */
export const CART_CREDENTIAL_COOKIE_PROD = '__Host-gp_cart';
export const CART_CREDENTIAL_COOKIE_DEV = 'gp_cart';

export function cartCredentialCookieName(isProduction: boolean): string {
  return isProduction ? CART_CREDENTIAL_COOKIE_PROD : CART_CREDENTIAL_COOKIE_DEV;
}

export type CartOwnerKind = 'USER' | 'GUEST';

export interface CartCredentialClaims {
  cartId: string;
  ownerKind: CartOwnerKind;
  /** The verified user id for a USER cart; the guest principal id otherwise. */
  ownerId: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  keyId: string;
}

export interface CartKey {
  keyId: string;
  secret: string;
}

/** Key ids appear in the token, so they must be unambiguous and printable. */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export const MIN_CART_ROOT_SECRET_LENGTH = 32;

export function deriveCartKey(rootSecret: string, keyId = '1'): CartKey {
  if (!rootSecret) throw new Error('CART_CREDENTIAL_SECRET_MISSING');
  // A short root is refused rather than derived from: the KDF widens whatever it is
  // given to 32 bytes, so a weak root would hide behind a healthy-looking key.
  if (rootSecret.length < MIN_CART_ROOT_SECRET_LENGTH) {
    throw new Error('CART_CREDENTIAL_SECRET_TOO_SHORT');
  }
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error('CART_CREDENTIAL_KEY_ID_INVALID');
  const secret = createHmac('sha256', `${KDF_LABEL}:${keyId}`).update(rootSecret).digest('hex');
  return { keyId, secret };
}

/**
 * Current key first, then the previous one during a rotation.
 *
 * One builder for both sides. Assembling the ring independently in the issuer and
 * the verifier is how they drift apart, and the symptom is every customer losing
 * their cart with nothing naming the rotation as the cause.
 */
export function buildCartKeyring(input: {
  rootSecret: string;
  currentKeyId?: string;
  previousKeyId?: string;
}): CartKey[] {
  const currentId = (input.currentKeyId || '1').trim();
  const keys = [deriveCartKey(input.rootSecret, currentId)];
  const previousId = (input.previousKeyId || '').trim();
  if (previousId && previousId !== currentId) {
    keys.push(deriveCartKey(input.rootSecret, previousId));
  }
  return keys;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // Length first: timingSafeEqual throws on a length mismatch.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function encodeClaims(claims: CartCredentialClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
}

function decodeClaims(encoded: string): CartCredentialClaims | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      !parsed ||
      typeof parsed.cartId !== 'string' ||
      (parsed.ownerKind !== 'USER' && parsed.ownerKind !== 'GUEST') ||
      typeof parsed.ownerId !== 'string' ||
      !Number.isSafeInteger(parsed.issuedAtSeconds) ||
      !Number.isSafeInteger(parsed.expiresAtSeconds) ||
      typeof parsed.keyId !== 'string'
    ) {
      return null;
    }
    return parsed as CartCredentialClaims;
  } catch {
    return null;
  }
}

export interface IssuedCartCredential {
  token: string;
  claims: CartCredentialClaims;
}

export function issueCartCredential(input: {
  key: CartKey;
  cartId: string;
  ownerKind: CartOwnerKind;
  ownerId: string;
  now?: Date;
  ttlSeconds?: number;
}): IssuedCartCredential {
  const now = input.now ?? new Date();
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const claims: CartCredentialClaims = {
    cartId: input.cartId,
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    issuedAtSeconds,
    expiresAtSeconds: issuedAtSeconds + (input.ttlSeconds ?? CART_CREDENTIAL_TTL_SECONDS),
    keyId: input.key.keyId,
  };
  const encoded = encodeClaims(claims);
  const payload = `${TOKEN_VERSION}.${encoded}`;
  return { token: `${payload}.${sign(input.key.secret, payload)}`, claims };
}

export type CartCredentialVerification =
  | { valid: true; claims: CartCredentialClaims }
  | { valid: false; reason: 'MALFORMED' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' | 'EXPIRED' };

/**
 * Verifies a credential against the accepted keyring.
 *
 * The SIGNATURE is checked before the expiry, deliberately. An expired token whose
 * signature is also forged should be reported as a forgery: checking expiry first
 * would let a caller learn that their fabricated token was structurally acceptable.
 */
export function verifyCartCredential(
  keys: readonly CartKey[],
  token: string | null | undefined,
  now: Date = new Date(),
): CartCredentialVerification {
  if (!token || keys.length === 0) return { valid: false, reason: 'MALFORMED' };

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { valid: false, reason: 'MALFORMED' };
  const [, encoded, mac] = parts;

  const claims = decodeClaims(encoded);
  if (!claims) return { valid: false, reason: 'MALFORMED' };

  const key = keys.find((candidate) => candidate.keyId === claims.keyId);
  if (!key) return { valid: false, reason: 'UNKNOWN_KEY' };

  if (!constantTimeEquals(sign(key.secret, `${TOKEN_VERSION}.${encoded}`), mac)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }

  if (claims.expiresAtSeconds * 1000 <= now.getTime()) return { valid: false, reason: 'EXPIRED' };

  return { valid: true, claims };
}
