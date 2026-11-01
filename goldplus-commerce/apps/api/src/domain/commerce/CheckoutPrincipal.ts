import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Trusted checkout principal, request fingerprint and idempotency state.
 *
 * Pure domain — no Hono, Drizzle or adapters — because this is the boundary that
 * decides who owns a checkout, and it should be readable and exhaustively
 * testable without a framework or a database anywhere near it.
 *
 * WHY A SERVER-ISSUED PRINCIPAL
 * The previous idempotency identity was derived from the caller's own email or
 * phone. Those are submitted in the request body, so a caller could adopt any
 * identity simply by typing it: send a victim's email with a guessed order key
 * and the replay path returned the victim's order. Scoping the key by email
 * closed the *global* key collision but left the ownership boundary made of
 * caller-supplied data, which is not an authorization boundary at all.
 *
 * A principal must be something the caller cannot mint. For an authenticated
 * customer that is the server-side user id. For a guest it must be issued by the
 * server, unguessable, expiring and verifiable — which means signed, so a
 * tampered or fabricated value is rejected rather than trusted.
 */

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

export type CheckoutPrincipalKind = 'USER' | 'GUEST';

export interface CheckoutPrincipal {
  kind: CheckoutPrincipalKind;
  /** Stable opaque identity. Never a caller-supplied value. */
  id: string;
}

export const GUEST_PRINCIPAL_TTL_SECONDS = 60 * 60 * 6; // six hours

/** Bytes of entropy in a guest principal. 32 bytes = 256 bits. */
const GUEST_ENTROPY_BYTES = 32;

export interface SignedGuestPrincipal {
  /** Cookie/token value handed to the client. */
  token: string;
  principalId: string;
  expiresAt: Date;
}

/**
 * Mints a guest principal.
 *
 * The token is `<principalId>.<expiryEpochSeconds>.<hmac>`. The HMAC covers both
 * the id and the expiry, so a caller can neither invent a principal nor extend
 * one — extending the expiry is exactly the attack a naive `id.expiry` format
 * invites.
 */
export function issueGuestPrincipal(
  secret: string,
  now: Date = new Date(),
  ttlSeconds: number = GUEST_PRINCIPAL_TTL_SECONDS,
): SignedGuestPrincipal {
  if (!secret) throw new Error('CHECKOUT_PRINCIPAL_SECRET_MISSING');
  const principalId = randomBytes(GUEST_ENTROPY_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const expiry = Math.floor(expiresAt.getTime() / 1000);
  const payload = `${principalId}.${expiry}`;
  return {
    token: `${payload}.${sign(secret, payload)}`,
    principalId,
    expiresAt,
  };
}

export type GuestPrincipalVerification =
  | { valid: true; principalId: string; expiresAt: Date }
  | { valid: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };

export function verifyGuestPrincipal(
  secret: string,
  token: string | null | undefined,
  now: Date = new Date(),
): GuestPrincipalVerification {
  if (!secret || !token) return { valid: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'MALFORMED' };
  const [principalId, expiryRaw, mac] = parts;
  if (!principalId || !expiryRaw || !mac) return { valid: false, reason: 'MALFORMED' };

  const expiry = Number(expiryRaw);
  if (!Number.isSafeInteger(expiry) || expiry <= 0) return { valid: false, reason: 'MALFORMED' };

  // Signature BEFORE expiry: an expired token whose signature is also forged
  // should report the forgery, and comparing the MAC first keeps the branch
  // structure independent of the token's contents.
  if (!verifySignature(secret, `${principalId}.${expiry}`, mac)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }
  if (expiry * 1000 <= now.getTime()) return { valid: false, reason: 'EXPIRED' };

  return { valid: true, principalId, expiresAt: new Date(expiry * 1000) };
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function verifySignature(secret: string, payload: string, provided: string): boolean {
  const expected = sign(secret, payload);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  // Length check first: timingSafeEqual throws on a length mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Namespaced so a user id and a guest id can never collide. */
export function principalKey(principal: CheckoutPrincipal): string {
  return `${principal.kind === 'USER' ? 'u' : 'g'}:${principal.id}`;
}

// ---------------------------------------------------------------------------
// Idempotency identity
// ---------------------------------------------------------------------------

/**
 * The durable idempotency identity: trusted principal + client order key.
 *
 * Hashed, so the raw key never reaches storage — callers put meaningful data in
 * idempotency keys — and so the stored value has a fixed width. The NUL
 * separator prevents a boundary collision where ("ab","c") and ("a","bc") would
 * otherwise share one identity.
 */
export function idempotencyIdentity(
  principal: CheckoutPrincipal,
  clientOrderKey: string,
): string {
  return createHash('sha256')
    // The separator is written as an ESCAPE, not as a literal NUL character.
    // A raw NUL in the source made git classify this whole file as binary, so
    // the module that decides who owns a checkout had no reviewable diff and no
    // merge; grep and ripgrep skipped it too. The hashed value is identical.
    .update(`${principalKey(principal)}\x00${clientOrderKey.trim()}`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Request fingerprint
// ---------------------------------------------------------------------------

export interface CheckoutFingerprintInput {
  /** 0196: the HMAC of a store credit / gift card code, when one is used (appended only then). */
  storeCreditCodeHash?: string | null;
  principal: CheckoutPrincipal;
  items: ReadonlyArray<{ productId: string; quantity: number }>;
  buyerType: string;
  couponCode?: string | null;
  deliveryZoneKey?: string | null;
  currency: string;
  acceptedQuoteId?: string | null;
  policyVersion: string;
  /**
   * WHERE the goods go. Previously absent, and the worst of the gaps: reusing a
   * key with a different delivery address was answered with the earlier order, so
   * a customer who corrected an address and resubmitted was silently given back
   * the order bound for the address they had just corrected away from.
   */
  deliveryAddress?: string | null;
  /** HOW the customer is reached. Changing it changes the order materially. */
  contactPhone?: string | null;
  contactEmail?: string | null;
  /**
   * The basket this checkout was raised against, and its version.
   *
   * The item list alone cannot distinguish "the same products, from the basket the
   * customer is actually looking at" from "the same products, from a basket that has
   * since moved on". With cart versioning in place (migration 0060) the version is the
   * cheap, exact way to say which basket state was priced.
   */
  cartId?: string | null;
  cartVersion?: number | null;
  /**
   * HOW they intend to pay. Switching between an online payment and an offline order is
   * a materially different operation with a different fulfilment path, and reusing one
   * key across both silently returned the first.
   */
  paymentMethod?: string | null;
  /**
   * Versions of the rules that produced the price.
   *
   * A checkout priced under one pricing or promotion version and replayed under another
   * is not the same operation, even with an identical basket. Including them means the
   * replay is refused rather than answered with a total nobody would compute today.
   */
  pricingVersion?: string | null;
  promotionVersion?: string | null;
  stockPolicyVersion?: string | null;
  deliveryPolicyVersion?: string | null;
  /**
   * Keyed digest secret.
   *
   * Optional so the function stays pure and testable, but supplying it is what makes the
   * free-text digests resistant to offline guessing — see `digest` below.
   */
  digestKey?: string | null;
}

/**
 * Length-prefixed canonical encoding.
 *
 * A single NUL separator is unambiguous only while no field can itself contain a
 * NUL byte. That held while every field was an id, an enum or a currency code. It
 * stops holding the moment free text from the client is included: a JSON string may
 * carry \u0000, so a crafted delivery address could shift a field boundary and make
 * two different requests share a fingerprint — precisely the check this hash exists
 * to perform. Prefixing each field with its byte length makes the boundaries
 * independent of the contents.
 */
function canonicalFields(fields: readonly string[]): string {
  return fields.map((f) => `${Buffer.byteLength(f, 'utf8')}:${f}`).join('|');
}

/**
 * Keyed digest for free-text personal data.
 *
 * The fingerprint stores only a hash, so no raw address, phone or email is persisted.
 * But an UNKEYED hash of personal data is weak in a specific way: the input space is
 * small and predictable. Anyone holding the stored digests could hash a list of
 * candidate phone numbers — there are only so many Ugandan mobile numbers — and learn
 * which customers a record belongs to. That is a re-identification attack on data we
 * deliberately chose not to store.
 *
 * An HMAC under a server-held key removes it: without the key, the digests cannot be
 * generated at all, so there is nothing to compare a guess against.
 *
 * When no key is supplied the value is hashed unkeyed rather than passed through in the
 * clear. That is weaker, and it is the honest fallback: silently omitting the field
 * would make two materially different requests share a fingerprint, which is worse than
 * a guessable digest.
 */
function digest(value: string, key: string | null | undefined): string {
  if (!value) return '';
  return key
    ? createHmac('sha256', key).update(value).digest('base64url')
    : createHash('sha256').update(value).digest('base64url');
}

/**
 * Canonical fingerprint of the operation the caller actually asked for.
 *
 * This is what makes "same key, different order" detectable. Without it, reusing
 * a key for a materially different basket silently returned the earlier order —
 * the customer is shown, and charged for, something they did not ask for.
 *
 * Items are sorted and merged so line order and split lines do not change the
 * fingerprint: `2×A` and `1×A, 1×A` are the same intent. Volatile values
 * (timestamps, trace ids, user agent) are deliberately excluded — including them
 * would make every retry a "different" request and defeat idempotency entirely.
 */
export function checkoutFingerprint(input: CheckoutFingerprintInput): string {
  const merged = new Map<string, number>();
  for (const item of input.items) {
    if (!item.productId) continue;
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }
  const items = [...merged.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productId, quantity]) => `${productId}:${quantity}`)
    .join(',');

  const canonical = canonicalFields([
    principalKey(input.principal),
    items,
    input.buyerType.trim().toLowerCase(),
    (input.couponCode ?? '').trim().toUpperCase(),
    (input.deliveryZoneKey ?? '').trim().toLowerCase(),
    input.currency.trim().toUpperCase(),
    input.acceptedQuoteId ?? '',
    input.policyVersion,
    // Normalised so cosmetic differences — casing, doubled spaces, a trailing
    // comma — are not read as a different order. Nothing more aggressive:
    // stripping punctuation or expanding abbreviations would start merging
    // addresses that are genuinely different.
    // Personal data goes in as a KEYED DIGEST, never in the clear and never as a
    // guessable hash. Normalised first, so cosmetic differences still collapse.
    digest(normaliseFreeText(input.deliveryAddress), input.digestKey),
    digest(normalisePhone(input.contactPhone), input.digestKey),
    digest((input.contactEmail ?? '').trim().toLowerCase(), input.digestKey),
    // Which basket, at which version.
    (input.cartId ?? '').trim(),
    input.cartVersion === null || input.cartVersion === undefined ? '' : String(input.cartVersion),
    // How they intend to pay: online and offline are different operations.
    (input.paymentMethod ?? '').trim().toLowerCase(),
    // The rule versions that produced the price. A replay under different rules is not
    // the same operation, even with an identical basket.
    (input.pricingVersion ?? '').trim(),
    (input.promotionVersion ?? '').trim(),
    (input.stockPolicyVersion ?? '').trim(),
    (input.deliveryPolicyVersion ?? '').trim(),
    // Appended only when present, so every fingerprint made without credit is unchanged.
    ...(input.storeCreditCodeHash ? [`credit:${input.storeCreditCodeHash}`] : []),
  ]);

  return createHash('sha256').update(canonical).digest('hex');
}

function normaliseFreeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[,;]+$/, '');
}

/**
 * Phone comparison ignores formatting but never digits.
 *
 * `+256 700 000 000` and `+256700000000` are the same number; `0700000000` and
 * `0700000001` are not. Only separators are removed — no attempt is made to
 * canonicalise a national number to E.164, because guessing a country code would
 * make two genuinely different numbers compare equal.
 */
function normalisePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s()\-.]/g, '');
}

/**
 * Bumped when a change makes older fingerprints unsafe to honour.
 *
 * v3: the fingerprint now covers the delivery address and contact details, and the
 * encoding is length-prefixed. Every stored fingerprint from v2 was computed over
 * strictly less data, so comparing one against a v3 value would report a conflict
 * for an identical request. Because the version is itself a fingerprint input,
 * bumping it makes old and new values unmatchable by construction rather than by
 * hoping the hash happens to differ.
 */
export const CHECKOUT_POLICY_VERSION = 'checkout-v4-keyed-fingerprint';

// ---------------------------------------------------------------------------
// Idempotency state machine
// ---------------------------------------------------------------------------

export type IdempotencyState =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';

/**
 * Whether the checkout WORKFLOW is still running — a different fact from where
 * the saga got to.
 *
 * These two were previously one column, which is how an order awaiting payment
 * came to be stored as COMPLETED: "the workflow stopped running" was written into
 * the same field that anything reading progress consulted, so every unpaid order
 * looked finished to reconciliation, support and the retention sweep.
 */
export type CheckoutOperationState =
  | 'IN_PROGRESS'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  /** The workflow finished running. It does NOT mean the customer paid. */
  | 'TERMINAL';

export interface IdempotencyRecord {
  identity: string;
  principalKey: string;
  fingerprint: string;
  state: IdempotencyState;
  /** Did the workflow finish running? */
  operationState: CheckoutOperationState;
  /**
   * Where the saga actually got to. Required for resumption: an order id alone
   * cannot say whether the reservation, the fulfilment event and the notification
   * event are each done, and each is independently owed.
   */
  stage: string;
  orderId: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * How long an IN_PROGRESS claim is honoured before another request may take it
 * over. A process that dies mid-checkout must not wedge the customer's key
 * forever; equally, a live request must not have its claim stolen while it is
 * still working.
 */
export const IDEMPOTENCY_LEASE_SECONDS = 120;
export const IDEMPOTENCY_RECORD_TTL_SECONDS = 60 * 60 * 24;

export type IdempotencyDecision =
  /** No record existed; this request owns the operation. */
  | { action: 'PROCEED' }
  /** A completed operation with the same intent; return its result. */
  | { action: 'RETURN_EXISTING'; orderId: string }
  /** Same key, materially different request, while a claim is still LIVE. */
  | { action: 'CONFLICT'; reason: 'FINGERPRINT_MISMATCH' }
  /**
   * The intent is spent: a settled attempt under it produced this order, and the
   * customer is now asking for something materially different. Not a conflict to
   * refuse, and not a replay to return: a decision the caller must surface.
   */
  | { action: 'SUPERSEDED_BY_ORDER'; orderId: string }
  /**
   * The intent is spent and produced NO order. There is nothing to duplicate and
   * nothing to replay, so the caller may start a fresh operation immediately.
   */
  | { action: 'INTENT_SPENT' }
  /** Another request holds a live claim. */
  | { action: 'IN_FLIGHT'; retryAfterSeconds: number }
  /** A prior attempt failed transiently and its lease has lapsed. */
  | { action: 'RETRY_ALLOWED' }
  /** A prior attempt failed permanently. */
  | { action: 'TERMINAL'; reason: string };

/**
 * Decides what a request may do given the record that already exists.
 *
 * The fingerprint is checked BEFORE the state, so a caller can never reuse a key
 * with a different basket and be handed the wrong outcome depending only on
 * timing. What a mismatch MEANS, though, depends on whether the earlier attempt
 * is still running.
 *
 * WHAT WAS WRONG
 * Every mismatch was refused as CONFLICT, whatever the state. That made a spent
 * intent a permanent dead end, because nothing clears the intent cookie except a
 * completed order or its twelve-hour expiry. Two ordinary journeys wedged on it:
 *
 *   - Checkout is refused because an item is unavailable (a TERMINAL failure).
 *     The customer does exactly the right thing and removes that item. The basket
 *     is now different, so the retry is answered CONFLICT rather than proceeding,
 *     and every later attempt is answered the same way.
 *   - An online payment fails, so the customer comes back and chooses to pay on
 *     delivery instead. The payment method is part of the fingerprint, so this
 *     too is answered CONFLICT.
 *
 * In both the customer is told "your basket changed since this checkout started"
 * and can do nothing about it for twelve hours. Observed in production on
 * 2026-08-27 (CHECKOUT_REFUSED / FINGERPRINT_MISMATCH).
 *
 * A mismatch is therefore only a CONFLICT while a claim is genuinely LIVE — two
 * submissions racing, where exactly one must own the operation. Once the earlier
 * attempt is over, a different request is simply a NEW operation.
 */
export function decideIdempotency(
  existing: IdempotencyRecord | null,
  fingerprint: string,
  now: Date = new Date(),
): IdempotencyDecision {
  if (!existing) return { action: 'PROCEED' };

  if (existing.fingerprint !== fingerprint) {
    // Racing submissions: refuse, so exactly one owns the operation.
    const claimIsLive =
      existing.state === 'IN_PROGRESS' &&
      now.getTime() < existing.updatedAt.getTime() + IDEMPOTENCY_LEASE_SECONDS * 1000;
    if (claimIsLive) return { action: 'CONFLICT', reason: 'FINGERPRINT_MISMATCH' };

    // The earlier attempt is over. If it left an order, say so rather than
    // quietly creating a second one for a customer who already has the first;
    // if it left nothing, there is nothing to protect and the customer may go on.
    return existing.orderId
      ? { action: 'SUPERSEDED_BY_ORDER', orderId: existing.orderId }
      : { action: 'INTENT_SPENT' };
  }

  switch (existing.state) {
    case 'COMPLETED':
      // A COMPLETED record with no order id is incoherent; refusing is safer
      // than inventing a replay target.
      return existing.orderId
        ? { action: 'RETURN_EXISTING', orderId: existing.orderId }
        : { action: 'TERMINAL', reason: 'COMPLETED_WITHOUT_ORDER' };

    case 'IN_PROGRESS': {
      const leaseEndsAt = existing.updatedAt.getTime() + IDEMPOTENCY_LEASE_SECONDS * 1000;
      if (now.getTime() < leaseEndsAt) {
        return {
          action: 'IN_FLIGHT',
          retryAfterSeconds: Math.max(1, Math.ceil((leaseEndsAt - now.getTime()) / 1000)),
        };
      }
      // The lease lapsed, so the owning process is presumed gone.
      return { action: 'RETRY_ALLOWED' };
    }

    case 'FAILED_RETRYABLE':
      return { action: 'RETRY_ALLOWED' };

    case 'FAILED_FINAL':
      return { action: 'TERMINAL', reason: existing.failureReason ?? 'CHECKOUT_FAILED' };
  }
}
