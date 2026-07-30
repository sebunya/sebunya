import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECKOUT_POLICY_VERSION,
  checkoutFingerprint,
  decideIdempotency,
  idempotencyIdentity,
  issueGuestPrincipal,
  principalKey,
  verifyGuestPrincipal,
  type CheckoutPrincipal,
  type IdempotencyRecord,
} from '../../apps/api/src/domain/commerce/CheckoutPrincipal';

/**
 * Checkout ownership used to be derived from the email or phone in the request
 * body. Those are caller-supplied, so they are not an authorization boundary at
 * all: anyone could adopt any identity by typing it. Scoping the idempotency key
 * by email closed the global key collision but left the boundary made of
 * attacker-controlled data.
 */

const SECRET = 'test-secret-not-a-real-credential';
const user = (id: string): CheckoutPrincipal => ({ kind: 'USER', id });
const guest = (id: string): CheckoutPrincipal => ({ kind: 'GUEST', id });

describe('guest principals are server-issued and unforgeable', () => {
  it('mints a high-entropy principal', () => {
    const a = issueGuestPrincipal(SECRET);
    const b = issueGuestPrincipal(SECRET);
    expect(a.principalId).not.toBe(b.principalId);
    // 32 bytes base64url ≈ 43 chars. Anything short enough to guess is useless.
    expect(a.principalId.length).toBeGreaterThanOrEqual(40);
  });

  it('accepts its own token', () => {
    const minted = issueGuestPrincipal(SECRET);
    const verified = verifyGuestPrincipal(SECRET, minted.token);
    expect(verified.valid).toBe(true);
    if (verified.valid) expect(verified.principalId).toBe(minted.principalId);
  });

  it('rejects a fabricated principal — the whole point of signing it', () => {
    // A caller inventing `someid.<future>.<junk>` must not become a principal.
    const forged = `${'a'.repeat(43)}.${Math.floor(Date.now() / 1000) + 9999}.deadbeef`;
    const verified = verifyGuestPrincipal(SECRET, forged);
    expect(verified.valid).toBe(false);
    if (!verified.valid) expect(verified.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects a token signed with a different secret', () => {
    const other = issueGuestPrincipal('a-different-secret');
    expect(verifyGuestPrincipal(SECRET, other.token).valid).toBe(false);
  });

  it('refuses an extended expiry, because the MAC covers the expiry', () => {
    // Without the expiry in the signed payload, a caller could keep a principal
    // alive forever by editing one number.
    const minted = issueGuestPrincipal(SECRET);
    const [id, , mac] = minted.token.split('.');
    const extended = `${id}.${Math.floor(Date.now() / 1000) + 999999}.${mac}`;
    const verified = verifyGuestPrincipal(SECRET, extended);
    expect(verified.valid).toBe(false);
    if (!verified.valid) expect(verified.reason).toBe('BAD_SIGNATURE');
  });

  it('reports an expired token as expired, not valid', () => {
    const minted = issueGuestPrincipal(SECRET, new Date(Date.now() - 10_000), 1);
    const verified = verifyGuestPrincipal(SECRET, minted.token);
    expect(verified.valid).toBe(false);
    if (!verified.valid) expect(verified.reason).toBe('EXPIRED');
  });

  it('rejects malformed and empty input without throwing', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', 'a.notanumber.c', null, undefined]) {
      expect(verifyGuestPrincipal(SECRET, bad as string).valid).toBe(false);
    }
  });

  it('refuses to mint without a secret rather than issuing an unsigned principal', () => {
    expect(() => issueGuestPrincipal('')).toThrow(/SECRET_MISSING/);
  });
});

describe('idempotency identity is bound to the trusted principal', () => {
  it('gives two principals different identities for the same key', () => {
    expect(idempotencyIdentity(user('u1'), 'order-1')).not.toBe(
      idempotencyIdentity(user('u2'), 'order-1'),
    );
  });

  it('separates a user from a guest with a colliding raw id', () => {
    // Without namespacing, user "x" and guest "x" would share every identity.
    expect(idempotencyIdentity(user('x'), 'k')).not.toBe(idempotencyIdentity(guest('x'), 'k'));
    expect(principalKey(user('x'))).not.toBe(principalKey(guest('x')));
  });

  it('is stable for the same principal and key', () => {
    expect(idempotencyIdentity(user('u1'), 'order-1')).toBe(
      idempotencyIdentity(user('u1'), 'order-1'),
    );
  });

  it('makes a stolen raw key useless without its principal', () => {
    const victimIdentity = idempotencyIdentity(user('victim'), 'order-1');
    for (const attacker of ['attacker', 'victim2', 'VICTIM']) {
      expect(idempotencyIdentity(user(attacker), 'order-1')).not.toBe(victimIdentity);
    }
  });

  it('does not store the raw key', () => {
    const identity = idempotencyIdentity(user('u1'), 'basket-for-jane-0771234567');
    expect(identity).not.toContain('jane');
    expect(identity).not.toContain('0771234567');
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('request fingerprint detects a materially different order', () => {
  const base = {
    principal: user('u1'),
    items: [{ productId: 'p1', quantity: 2 }],
    buyerType: 'retail',
    couponCode: null,
    deliveryZoneKey: 'kampala',
    currency: 'UGX',
    acceptedQuoteId: null,
    policyVersion: CHECKOUT_POLICY_VERSION,
  };

  it('is stable for the identical request', () => {
    expect(checkoutFingerprint(base)).toBe(checkoutFingerprint({ ...base }));
  });

  it.each([
    ['different product', { items: [{ productId: 'p2', quantity: 2 }] }],
    ['different quantity', { items: [{ productId: 'p1', quantity: 3 }] }],
    ['extra line', { items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }] }],
    ['different buyer type', { buyerType: 'wholesale' }],
    ['different delivery area', { deliveryZoneKey: 'gulu' }],
    ['added coupon', { couponCode: 'SAVE10' }],
    ['different currency', { currency: 'USD' }],
    ['different accepted quote', { acceptedQuoteId: 'q-1' }],
    ['different principal', { principal: user('u2') }],
  ])('changes for a %s', (_label, override) => {
    expect(checkoutFingerprint({ ...base, ...override })).not.toBe(checkoutFingerprint(base));
  });

  it('ignores line order and split lines — same intent, same fingerprint', () => {
    // 2×A and 1×A + 1×A are the same order; treating them as different would
    // turn an ordinary client re-render into a spurious conflict.
    const merged = checkoutFingerprint({ ...base, items: [{ productId: 'p1', quantity: 2 }] });
    const split = checkoutFingerprint({
      ...base,
      items: [{ productId: 'p1', quantity: 1 }, { productId: 'p1', quantity: 1 }],
    });
    expect(split).toBe(merged);

    const twoLines = [{ productId: 'a', quantity: 1 }, { productId: 'b', quantity: 2 }];
    expect(checkoutFingerprint({ ...base, items: twoLines })).toBe(
      checkoutFingerprint({ ...base, items: [...twoLines].reverse() }),
    );
  });

  it('normalises coupon case and delivery-zone case', () => {
    expect(checkoutFingerprint({ ...base, couponCode: 'save10' })).toBe(
      checkoutFingerprint({ ...base, couponCode: 'SAVE10' }),
    );
  });

  it('changes when the policy version is bumped', () => {
    // A bump exists precisely to stop older fingerprints being honoured.
    expect(checkoutFingerprint({ ...base, policyVersion: 'checkout-v3' })).not.toBe(
      checkoutFingerprint(base),
    );
  });
});

describe('idempotency decisions', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  const record = (over: Partial<IdempotencyRecord> = {}): IdempotencyRecord => ({
    identity: 'i1',
    principalKey: 'u:1',
    fingerprint: 'fp-1',
    state: 'COMPLETED',
    orderId: 'order-1',
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    ...over,
  });

  it('proceeds when nothing exists', () => {
    expect(decideIdempotency(null, 'fp-1', now)).toEqual({ action: 'PROCEED' });
  });

  it('returns the original order for the same intent', () => {
    expect(decideIdempotency(record(), 'fp-1', now)).toEqual({
      action: 'RETURN_EXISTING',
      orderId: 'order-1',
    });
  });

  it('conflicts on a different fingerprint, whatever the state', () => {
    // Checked before the state in every branch: otherwise reusing a key with a
    // different basket would be answered differently depending only on timing.
    for (const state of ['COMPLETED', 'IN_PROGRESS', 'FAILED_RETRYABLE', 'FAILED_FINAL'] as const) {
      const decision = decideIdempotency(record({ state, failureReason: 'x' }), 'fp-OTHER', now);
      expect(decision.action).toBe('CONFLICT');
    }
  });

  it('reports a live claim as in-flight with a retry hint', () => {
    const decision = decideIdempotency(record({ state: 'IN_PROGRESS', orderId: null }), 'fp-1', now);
    expect(decision.action).toBe('IN_FLIGHT');
    if (decision.action === 'IN_FLIGHT') expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('allows takeover once the claim lease has lapsed', () => {
    // A process that died mid-checkout must not wedge the key forever.
    const stale = record({
      state: 'IN_PROGRESS',
      orderId: null,
      updatedAt: new Date(now.getTime() - 10 * 60_000),
    });
    expect(decideIdempotency(stale, 'fp-1', now)).toEqual({ action: 'RETRY_ALLOWED' });
  });

  it('allows a retry after a transient failure', () => {
    expect(
      decideIdempotency(record({ state: 'FAILED_RETRYABLE', orderId: null }), 'fp-1', now),
    ).toEqual({ action: 'RETRY_ALLOWED' });
  });

  it('refuses a terminal failure and carries its reason', () => {
    const decision = decideIdempotency(
      record({ state: 'FAILED_FINAL', orderId: null, failureReason: 'PRODUCT_UNAVAILABLE' }),
      'fp-1',
      now,
    );
    expect(decision.action).toBe('TERMINAL');
    if (decision.action === 'TERMINAL') expect(decision.reason).toBe('PRODUCT_UNAVAILABLE');
  });

  it('refuses rather than inventing a replay target for an incoherent record', () => {
    const decision = decideIdempotency(record({ state: 'COMPLETED', orderId: null }), 'fp-1', now);
    expect(decision.action).toBe('TERMINAL');
  });
});

describe('the checkout response never publishes the domain order', () => {
  const routeFile = readFileSync(
    join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
    'utf8',
  );
  // Comments are stripped so prose ABOUT the old pattern does not read as the
  // pattern itself, and the slice is bounded to the checkout handler so another
  // route's catch block is not mistaken for this one's.
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const route = stripComments(routeFile);
  const checkoutHandler = route.slice(
    route.indexOf("routes.post('/orders/create'"),
    route.indexOf('const maskPhone'),
  );
  const dto = readFileSync(
    join(__dirname, '../../apps/api/src/application/mappers/toCheckoutResponseDto.ts'),
    'utf8',
  );

  it('stopped spreading the order into JSON', () => {
    // `{ ...result.order }` published the customer's full name, phone, email and
    // delivery address — and on the replay path, for whatever key matched.
    expect(checkoutHandler).not.toContain('...result.order');
  });

  it('builds the response as a named allowlist, not a filtered entity', () => {
    // A subtractive approach silently re-exposes whatever is added later.
    for (const field of ['orderId', 'orderNumber', 'reservationState', 'nextAction']) {
      expect(dto).toContain(`${field}:`);
    }
    for (const leaked of ['customerEmail', 'customerPhone', 'customerName', 'deliveryAddress']) {
      expect(dto).not.toContain(leaked);
    }
  });

  it('derives the next action from the canonical reservation state', () => {
    // So a client cannot be told to collect payment for an unpayable order.
    expect(dto).toContain('mayProgressToPayment(reservationState)');
  });

  it('claims atomically before any commerce work, now inside the use case', () => {
    // The claim moved with the rest of the orchestration.
    const useCase = readFileSync(
      join(__dirname, '../../apps/api/src/application/use-cases/commerce/ExecuteCheckoutIntentUseCase.ts'),
      'utf8',
    );
    const claimAt = useCase.indexOf('this.deps.idempotency.claim(');
    const orderAt = useCase.indexOf('this.deps.orders.execute(');
    expect(claimAt).toBeGreaterThan(-1);
    expect(orderAt).toBeGreaterThan(claimAt);
  });

  it('returns 409 IDEMPOTENCY_CONFLICT for a reused key with a different order', () => {
    expect(checkoutHandler).toContain('IDEMPOTENCY_CONFLICT');
  });

  it('does not leak internal error text to public callers', () => {
    // The route now maps typed outcomes; only an allowlisted business code is
    // named back to the customer.
    expect(checkoutHandler).toContain('TERMINAL_PUBLIC_CODES.includes(outcome.reason)');
    expect(checkoutHandler).toContain("message: 'The order could not be completed. Please try again.'");
    const useCase = readFileSync(
      join(__dirname, '../../apps/api/src/application/use-cases/commerce/ExecuteCheckoutIntentUseCase.ts'),
      'utf8',
    );
    // The typed reason for an unexpected error is a constant, never the message.
    expect(useCase).toContain("reason: 'CHECKOUT_ERROR'");
  });
});
