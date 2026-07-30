import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Checkout intent token — one implementation, shared by the BFF that issues it
 * and the API that verifies it.
 *
 * WHY THE BFF OWNS ISSUANCE
 * The real storefront path is browser → Astro SSR → server-side fetch → API. The
 * API's `Set-Cookie` therefore lands on the Astro server's fetch response and
 * never reaches the browser, and the browser's `Cookie` header never reaches the
 * API. An API-minted guest cookie is not a browser identity in that topology at
 * all: every request mints a fresh principal, so a retry gets a NEW identity and
 * the idempotency claim can never match. Only the layer that owns the browser
 * connection can own the cookie.
 *
 * So: Astro issues and stores the cookie, and forwards this signed opaque token
 * to the API. The API verifies it and never mints one.
 *
 * KEY SEPARATION
 * Derived from a dedicated secret where present, otherwise HKDF-style derived
 * from JWT_SECRET with an explicit label. Reusing a signing key across two
 * purposes lets a token minted for one be presented as the other; the label
 * makes the two key streams unrelated even from one root secret.
 */

const KDF_LABEL = 'goldplus-checkout-intent-v1';
const TOKEN_VERSION = 'v1';
const INTENT_ENTROPY_BYTES = 32;

export const CHECKOUT_INTENT_TTL_SECONDS = 60 * 60 * 12;

export type CheckoutPrincipalKind = 'USER' | 'GUEST';

export interface CheckoutIntentClaims {
  intentId: string;
  kind: CheckoutPrincipalKind;
  /** Verified user id for USER intents; the opaque guest id for GUEST intents. */
  principalId: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  keyId: string;
}

export interface IntentKey {
  keyId: string;
  secret: string;
}

/**
 * Derives the signing key.
 *
 * `keyId` is carried in the token so a rotation can verify against the current
 * and immediately previous key without invalidating every in-flight checkout —
 * a rotation that logs out every mid-checkout customer is a rotation nobody
 * performs.
 */
export const MIN_INTENT_ROOT_SECRET_LENGTH = 32;

/** Key ids appear in the token, so they must be unambiguous and printable. */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function deriveIntentKey(rootSecret: string, keyId = '1'): IntentKey {
  if (!rootSecret) throw new Error('CHECKOUT_INTENT_SECRET_MISSING');
  // A short root is refused rather than derived from. The KDF makes the derived key
  // 32 bytes wide whatever it is given, which hides a weak root behind a
  // healthy-looking key — a deployment with an eight-character secret would look
  // exactly like a correct one, and the intent token is what authorizes payment.
  if (rootSecret.length < MIN_INTENT_ROOT_SECRET_LENGTH) {
    throw new Error('CHECKOUT_INTENT_SECRET_TOO_SHORT');
  }
  // The key id is part of the signed payload and is echoed in the token. An id
  // containing the payload separator would let one key's token be read as
  // another's, which is the one thing a key id must never allow.
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error('CHECKOUT_INTENT_KEY_ID_INVALID');
  const secret = createHmac('sha256', `${KDF_LABEL}:${keyId}`).update(rootSecret).digest('hex');
  return { keyId, secret };
}

/**
 * Builds the accepted keyring: current first, then the previous key if rotating.
 *
 * Extracted so the API and the storefront cannot drift. They each assembled this
 * list independently from the same environment variables, and a keyring that
 * differs between the issuer and the verifier rejects every token — the failure
 * would appear as customers unable to check out, with nothing pointing at the
 * rotation as the cause.
 *
 * Verification order matters: the current key is tried first, so the common case
 * costs one HMAC and only a token from the rotation window costs two.
 */
export function buildIntentKeyring(input: {
  rootSecret: string;
  currentKeyId?: string;
  previousKeyId?: string;
}): IntentKey[] {
  const currentId = (input.currentKeyId || '1').trim();
  const keys = [deriveIntentKey(input.rootSecret, currentId)];

  const previousId = (input.previousKeyId || '').trim();
  // A previous id equal to the current one is a configuration mistake, not a
  // rotation. Silently adding it would double every verification cost and make the
  // logs claim a rotation was in progress when none was.
  if (previousId && previousId !== currentId) {
    keys.push(deriveIntentKey(input.rootSecret, previousId));
  }
  return keys;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Base64url JSON, so the token is opaque to the browser but self-describing. */
function encodeClaims(claims: CheckoutIntentClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
}

function decodeClaims(encoded: string): CheckoutIntentClaims | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      typeof parsed?.intentId !== 'string' ||
      (parsed.kind !== 'USER' && parsed.kind !== 'GUEST') ||
      typeof parsed?.principalId !== 'string' ||
      !Number.isSafeInteger(parsed?.issuedAtSeconds) ||
      !Number.isSafeInteger(parsed?.expiresAtSeconds) ||
      typeof parsed?.keyId !== 'string'
    ) {
      return null;
    }
    return parsed as CheckoutIntentClaims;
  } catch {
    return null;
  }
}

export interface IssuedCheckoutIntent {
  token: string;
  claims: CheckoutIntentClaims;
}

export function issueCheckoutIntent(args: {
  key: IntentKey;
  kind: CheckoutPrincipalKind;
  /** Required for USER; ignored for GUEST, which gets a generated id. */
  userId?: string;
  now?: Date;
  ttlSeconds?: number;
}): IssuedCheckoutIntent {
  const now = args.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const ttl = args.ttlSeconds ?? CHECKOUT_INTENT_TTL_SECONDS;

  if (args.kind === 'USER' && !args.userId) {
    throw new Error('CHECKOUT_INTENT_USER_ID_REQUIRED');
  }

  const claims: CheckoutIntentClaims = {
    intentId: randomBytes(16).toString('base64url'),
    kind: args.kind,
    principalId:
      args.kind === 'USER' ? args.userId! : randomBytes(INTENT_ENTROPY_BYTES).toString('base64url'),
    issuedAtSeconds: nowSeconds,
    expiresAtSeconds: nowSeconds + ttl,
    keyId: args.key.keyId,
  };

  const encoded = encodeClaims(claims);
  // The version is inside the signed payload, so it cannot be downgraded.
  const payload = `${TOKEN_VERSION}.${encoded}`;
  return { token: `${payload}.${sign(args.key.secret, payload)}`, claims };
}

export type IntentVerification =
  | { valid: true; claims: CheckoutIntentClaims }
  | { valid: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'UNKNOWN_KEY' };

/**
 * Verifies a token against the accepted keys.
 *
 * Signature is checked before expiry so a forged token is reported as forged
 * rather than as merely stale, and the branch taken does not depend on the
 * token's own contents.
 */
export function verifyCheckoutIntent(
  keys: IntentKey[],
  token: string | null | undefined,
  now: Date = new Date(),
): IntentVerification {
  if (!token) return { valid: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'MALFORMED' };
  const [version, encoded, mac] = parts;
  if (version !== TOKEN_VERSION || !encoded || !mac) return { valid: false, reason: 'MALFORMED' };

  const claims = decodeClaims(encoded);
  if (!claims) return { valid: false, reason: 'MALFORMED' };

  const key = keys.find((k) => k.keyId === claims.keyId);
  if (!key) return { valid: false, reason: 'UNKNOWN_KEY' };

  if (!constantTimeEquals(sign(key.secret, `${version}.${encoded}`), mac)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }
  if (claims.expiresAtSeconds * 1000 <= now.getTime()) {
    return { valid: false, reason: 'EXPIRED' };
  }
  return { valid: true, claims };
}

/** Namespaced so a user id and a guest id can never collide. */
export function intentPrincipalKey(claims: CheckoutIntentClaims): string {
  return `${claims.kind === 'USER' ? 'u' : 'g'}:${claims.principalId}`;
}

/** Operations that can be claimed against an intent. */
export type CheckoutOperation = 'CREATE_ORDER' | 'START_PAYMENT';

/**
 * Length-prefixed canonical encoding.
 *
 * Space- or colon-joined concatenation is ambiguous: ("ab","c") and ("a","bc")
 * produce the same string and therefore the same digest, so two different
 * operations could share one idempotency identity. Prefixing each field with its
 * byte length makes the encoding injective.
 */
function canonical(fields: readonly string[]): string {
  return fields.map((f) => `${Buffer.byteLength(f, 'utf8')}:${f}`).join('|');
}

/**
 * The durable operation identity — derived entirely server-side.
 *
 * It previously mixed in a `clientOrderKey` taken from a hidden form field. A
 * hidden field is caller-controlled, so the client could vary it to force a
 * duplicate order, or supply another customer's value. Deriving from the verified
 * principal, the signed intent id, the operation label and the policy version
 * removes the caller from the identity entirely.
 *
 * Bound to the INTENT rather than merely the principal: a genuine second purchase
 * gets a new intent and therefore a new identity, while every retry of the same
 * intended purchase collapses onto one.
 */
export function checkoutOperationIdentity(
  claims: CheckoutIntentClaims,
  operation: CheckoutOperation,
  policyVersion: string,
): string {
  return createHash('sha256')
    .update(canonical([intentPrincipalKey(claims), claims.intentId, operation, policyVersion]))
    .digest('hex');
}
