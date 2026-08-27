import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_POLICY_VERSION,
  checkoutFingerprint,
  decideIdempotency,
  type IdempotencyRecord,
} from '../../apps/api/src/domain/commerce/CheckoutPrincipal';

/**
 * A refused checkout must never become a dead end.
 *
 * WHAT WENT WRONG IN PRODUCTION (2026-08-27)
 * The checkout intent cookie is deliberately retained across a payment handoff,
 * so a customer coming back reaches the SAME order instead of creating a second.
 * But the idempotency decision refused every fingerprint mismatch as CONFLICT,
 * whatever the state of the earlier attempt, and nothing clears that cookie
 * except a completed order or its twelve-hour expiry.
 *
 * So the two most ordinary recoveries both wedged, and the customer was told
 * "your basket changed since this checkout started" about a basket that was
 * fine, with no way forward for twelve hours:
 *
 *   A. Checkout refused because an item was unavailable. The customer removes
 *      that item, which is exactly right, and every retry is refused.
 *   B. An online payment fails. The customer comes back and chooses to pay on
 *      delivery instead, and every retry is refused.
 *
 * These tests pin both journeys, and pin the two guarantees that must survive
 * the fix: never replay the wrong order, and never quietly create a second one.
 */

const now = new Date('2026-08-27T01:29:00Z');

const fingerprintFor = (over: Partial<Parameters<typeof checkoutFingerprint>[0]> = {}) =>
  checkoutFingerprint({
    principal: { kind: 'USER', id: 'u1' },
    items: [{ productId: 'charger', quantity: 1 }],
    buyerType: 'retail',
    couponCode: null,
    deliveryZoneKey: 'wakiso',
    currency: 'UGX',
    acceptedQuoteId: null,
    policyVersion: CHECKOUT_POLICY_VERSION,
    deliveryAddress: 'Kasangati, Kasagati kiblock',
    contactPhone: '+256705004545',
    contactEmail: null,
    paymentMethod: 'pesapal',
    ...over,
  });

const record = (over: Partial<IdempotencyRecord> = {}): IdempotencyRecord => ({
  identity: 'id-1',
  principalKey: 'u:u1',
  fingerprint: fingerprintFor(),
  state: 'COMPLETED',
  operationState: 'TERMINAL',
  stage: 'PAYMENT_READY',
  orderId: 'order-1',
  failureReason: null,
  createdAt: now,
  updatedAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
  ...over,
});

describe('the scenarios are real: these changes DO move the fingerprint', () => {
  it('changing only the payment method is a different fingerprint', () => {
    expect(fingerprintFor({ paymentMethod: 'offline' })).not.toBe(fingerprintFor());
  });

  it('removing an unavailable item is a different fingerprint', () => {
    expect(fingerprintFor({ items: [] })).not.toBe(fingerprintFor());
  });
});

describe('journey A: the customer fixes the basket after a terminal refusal', () => {
  it('lets them through instead of refusing for twelve hours', () => {
    // The refusal created no order, so there is nothing to duplicate.
    const afterRemovingTheItem = decideIdempotency(
      record({ state: 'FAILED_FINAL', orderId: null, failureReason: 'PRODUCT_UNAVAILABLE' }),
      fingerprintFor({ items: [] }),
      now,
    );
    expect(afterRemovingTheItem.action).toBe('INTENT_SPENT');
  });
});

describe('journey B: the customer switches payment method after a failed payment', () => {
  const decision = decideIdempotency(record(), fingerprintFor({ paymentMethod: 'offline' }), now);

  it('is not refused as a conflict', () => {
    expect(decision.action).not.toBe('CONFLICT');
  });

  it('names the order they already have rather than creating a second', () => {
    expect(decision.action).toBe('SUPERSEDED_BY_ORDER');
    if (decision.action === 'SUPERSEDED_BY_ORDER') expect(decision.orderId).toBe('order-1');
  });
});

describe('the guarantees that must survive', () => {
  it('still refuses a different basket while a claim is genuinely live', () => {
    // Two submissions racing: exactly one may own the operation.
    const decision = decideIdempotency(
      record({ state: 'IN_PROGRESS', operationState: 'IN_PROGRESS', updatedAt: now }),
      fingerprintFor({ paymentMethod: 'offline' }),
      now,
    );
    expect(decision.action).toBe('CONFLICT');
  });

  it('never replays the earlier order for a materially different request', () => {
    for (const state of ['COMPLETED', 'IN_PROGRESS', 'FAILED_RETRYABLE', 'FAILED_FINAL'] as const) {
      const decision = decideIdempotency(
        record({ state, failureReason: 'x' }),
        fingerprintFor({ items: [{ productId: 'something-else', quantity: 9 }] }),
        now,
      );
      expect(decision.action).not.toBe('RETURN_EXISTING');
    }
  });

  it('still replays the SAME request onto the same order', () => {
    // Ordinary idempotency: a double submit must not make two orders.
    expect(decideIdempotency(record(), fingerprintFor(), now)).toEqual({
      action: 'RETURN_EXISTING',
      orderId: 'order-1',
    });
  });
});

describe('the storefront recovers without the customer noticing', () => {
  const page = readFileSync(
    resolve(__dirname, '../../apps/web/src/pages/checkout.astro'),
    'utf8',
  );

  it('re-mints and resubmits exactly once when the intent was spent', () => {
    expect(page).toMatch(/result\.code === 'CHECKOUT_INTENT_SPENT'/);
    expect(page).toMatch(/issueFreshCheckoutIntent\(Astro\.cookies, authenticatedUserId\)/);
    // One retry, not a loop.
    expect(page.match(/issueFreshCheckoutIntent\(/g)?.length).toBe(1);
  });

  it('pays through the intent the order was actually created under', () => {
    // Re-minting and then handing the OLD token to payment would refuse the
    // handoff for an order that exists.
    expect(page).toMatch(/intentToken: activeIntentToken/);
  });

  it('offers the existing order instead of duplicating it', () => {
    expect(page).toMatch(/result\.code === 'CHECKOUT_ALREADY_ORDERED'/);
    expect(page).toMatch(/href: `\/orders\/\$\{result\.existingOrder\.orderId\}`/);
    // The already-ordered branch must NOT be a place we re-mint an intent.
    const branch = page.slice(page.indexOf("CHECKOUT_ALREADY_ORDERED"));
    expect(branch.slice(0, 900)).not.toMatch(/issueFreshCheckoutIntent/);
  });

  it('no longer blames a basket that did not change', () => {
    const client = readFileSync(
      resolve(__dirname, '../../apps/web/src/lib/checkoutClient.ts'),
      'utf8',
    );
    expect(client).not.toMatch(/Your basket changed since this checkout started/);
  });
});
