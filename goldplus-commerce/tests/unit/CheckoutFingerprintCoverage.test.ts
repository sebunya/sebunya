import { describe, it, expect } from 'vitest';
import {
  CHECKOUT_POLICY_VERSION,
  checkoutFingerprint,
  type CheckoutFingerprintInput,
} from '../../apps/api/src/domain/commerce/CheckoutPrincipal';

/**
 * The fingerprint decides whether "same idempotency key" means "same order".
 *
 * It covered the basket, the buyer type, the coupon, the delivery ZONE and the
 * currency — but not the delivery ADDRESS and not the contact details. So a
 * customer who noticed a wrong house number, corrected it and resubmitted was
 * answered with the earlier order: the request looked identical, and the goods
 * stayed bound for the address they had just corrected away from. Same for a
 * corrected phone number, which is how a delivery driver reaches them.
 *
 * Every test below is a pair: change one thing, and the fingerprint must change.
 * Change nothing that matters, and it must not.
 */

const base: CheckoutFingerprintInput = {
  principal: { kind: 'GUEST', id: 'g1' },
  items: [{ productId: 'p1', quantity: 2 }],
  buyerType: 'retail',
  couponCode: null,
  deliveryZoneKey: 'kampala',
  currency: 'UGX',
  acceptedQuoteId: null,
  policyVersion: CHECKOUT_POLICY_VERSION,
  deliveryAddress: '12 Main Street, Nakawa',
  contactPhone: '+256700000000',
  contactEmail: 'buyer@example.com',
};

const fp = (over: Partial<CheckoutFingerprintInput> = {}) =>
  checkoutFingerprint({ ...base, ...over });

describe('a materially different request gets a different fingerprint', () => {
  it('detects a changed delivery address', () => {
    // The gap that mattered most: a corrected address was silently ignored.
    expect(fp({ deliveryAddress: '14 Main Street, Nakawa' })).not.toBe(fp());
  });

  it('detects a changed contact phone', () => {
    expect(fp({ contactPhone: '+256700000001' })).not.toBe(fp());
  });

  it('detects a changed contact email', () => {
    expect(fp({ contactEmail: 'someone.else@example.com' })).not.toBe(fp());
  });

  it('detects an address being added where there was none', () => {
    expect(fp({ deliveryAddress: null })).not.toBe(fp());
  });

  it('still detects the things it already detected', () => {
    expect(fp({ items: [{ productId: 'p1', quantity: 3 }] })).not.toBe(fp());
    expect(fp({ items: [{ productId: 'p2', quantity: 2 }] })).not.toBe(fp());
    expect(fp({ buyerType: 'wholesale' })).not.toBe(fp());
    expect(fp({ couponCode: 'SAVE10' })).not.toBe(fp());
    expect(fp({ deliveryZoneKey: 'wakiso' })).not.toBe(fp());
    expect(fp({ currency: 'USD' })).not.toBe(fp());
    expect(fp({ acceptedQuoteId: 'quote-2' })).not.toBe(fp());
    expect(fp({ principal: { kind: 'GUEST', id: 'g2' } })).not.toBe(fp());
    expect(fp({ principal: { kind: 'USER', id: 'g1' } })).not.toBe(fp());
  });
});

describe('a cosmetically different but identical request keeps its fingerprint', () => {
  it('ignores address casing, padding and doubled spaces', () => {
    // Otherwise every retry that re-serialised the form would look like a
    // different order and defeat idempotency entirely.
    expect(fp({ deliveryAddress: '  12  MAIN   street, Nakawa ' })).toBe(fp());
  });

  it('ignores a trailing comma on the address', () => {
    expect(fp({ deliveryAddress: '12 Main Street, Nakawa,' })).toBe(fp());
  });

  it('ignores phone formatting but never phone digits', () => {
    expect(fp({ contactPhone: '+256 700 000 000' })).toBe(fp());
    expect(fp({ contactPhone: '+256-700-000.000' })).toBe(fp());
    expect(fp({ contactPhone: '+256700000009' })).not.toBe(fp());
  });

  it('ignores email casing', () => {
    expect(fp({ contactEmail: 'Buyer@Example.COM' })).toBe(fp());
  });

  it('treats split lines of the same product as one intent', () => {
    // 2×A and 1×A + 1×A are the same order.
    expect(
      fp({ items: [{ productId: 'p1', quantity: 1 }, { productId: 'p1', quantity: 1 }] }),
    ).toBe(fp());
  });

  it('ignores line order', () => {
    const a = fp({ items: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 1 }] });
    const b = fp({ items: [{ productId: 'p2', quantity: 1 }, { productId: 'p1', quantity: 1 }] });
    expect(a).toBe(b);
  });
});

describe('field boundaries cannot be shifted', () => {
  it('does not let content move across a field boundary', () => {
    // With a plain separator, moving text from one field into the next can
    // reproduce the same joined string — so two different orders would share a
    // fingerprint, which is exactly the check this hash exists to perform.
    const a = fp({ deliveryAddress: '12 Main', contactPhone: '256700000000' });
    const b = fp({ deliveryAddress: '12 Main256700000000', contactPhone: '' });
    expect(a).not.toBe(b);
  });

  it('is not fooled by a NUL byte inside free text', () => {
    // The previous encoding joined fields with a NUL, which is unambiguous only
    // while no field can contain one — and a JSON string may carry \u0000. Under
    // NUL separation these two inputs produce the SAME joined string:
    //   address='12 Main\u0000+256700000000', phone=''
    //   address='12 Main',                    phone='+256700000000'
    // so they would have shared one fingerprint. The escape is written out rather
    // than embedded as a raw byte so the intent survives reading the file.
    const smuggled = fp({ deliveryAddress: '12 Main\u0000+256700000000', contactPhone: '' });
    const genuine = fp({ deliveryAddress: '12 Main', contactPhone: '+256700000000' });
    expect(smuggled).not.toBe(genuine);
  });

  it('distinguishes an empty field from an absent one only when it changes meaning', () => {
    // Both normalise to the empty string, which is correct: "no email given" is
    // one fact, however it arrived.
    expect(fp({ contactEmail: '' })).toBe(fp({ contactEmail: null }));
    expect(fp({ contactEmail: undefined })).toBe(fp({ contactEmail: null }));
  });
});

describe('the policy version retires old fingerprints', () => {
  it('names the version that includes keyed digests and the basket', () => {
    // Every stored fingerprint from an earlier version was computed over strictly less
    // data, and v3's personal-data digests were unkeyed. Because the version is itself an
    // input, bumping it makes old and new values unmatchable by construction rather than
    // by hoping the hash differs.
    expect(CHECKOUT_POLICY_VERSION).toBe('checkout-v4-keyed-fingerprint');
  });

  it('changes the fingerprint when the version changes', () => {
    expect(fp({ policyVersion: 'checkout-v2-trusted-principal' })).not.toBe(fp());
  });
});

describe('the basket, the payment method and the rule versions all count', () => {
  it('detects a different basket version', () => {
    // The item list alone cannot distinguish the basket the customer is looking at from
    // one that has since moved on.
    expect(fp({ cartId: 'cart-1', cartVersion: 4 })).not.toBe(fp({ cartId: 'cart-1', cartVersion: 5 }));
  });

  it('detects a different basket entirely', () => {
    expect(fp({ cartId: 'cart-1' })).not.toBe(fp({ cartId: 'cart-2' }));
  });

  it('detects a switch between online and offline payment', () => {
    // A materially different operation with a different fulfilment path. Reusing one key
    // across both silently returned the first.
    expect(fp({ paymentMethod: 'pesapal' })).not.toBe(fp({ paymentMethod: 'offline' }));
  });

  it('ignores payment-method casing', () => {
    expect(fp({ paymentMethod: 'PesaPal' })).toBe(fp({ paymentMethod: 'pesapal' }));
  });

  it('detects a change in any rule version that produced the price', () => {
    for (const field of ['pricingVersion', 'promotionVersion', 'stockPolicyVersion', 'deliveryPolicyVersion'] as const) {
      expect(fp({ [field]: 'a' }), field).not.toBe(fp({ [field]: 'b' }));
    }
  });
});

describe('personal data is digested under a key, not merely hashed', () => {
  const KEY = 'k'.repeat(32);

  it('produces a different fingerprint with and without a key', () => {
    expect(fp({ digestKey: KEY })).not.toBe(fp({ digestKey: null }));
  });

  it('produces a different fingerprint under a different key', () => {
    expect(fp({ digestKey: KEY })).not.toBe(fp({ digestKey: 'j'.repeat(32) }));
  });

  it('still detects a changed address under a key', () => {
    // Keying must not flatten the field into a constant.
    expect(fp({ digestKey: KEY, deliveryAddress: '12 Main' }))
      .not.toBe(fp({ digestKey: KEY, deliveryAddress: '14 Main' }));
  });

  it('still ignores cosmetic differences under a key', () => {
    expect(fp({ digestKey: KEY, deliveryAddress: '  12  MAIN   street, Nakawa ' }))
      .toBe(fp({ digestKey: KEY }));
  });

  it('does not make an absent field indistinguishable from a present one', () => {
    // An empty value digests to the empty string rather than to a hash of "", so "no
    // email given" stays one fact however it arrived.
    expect(fp({ digestKey: KEY, contactEmail: null }))
      .not.toBe(fp({ digestKey: KEY, contactEmail: 'a@b.test' }));
  });
});

describe('the fingerprint is stable and opaque', () => {
  it('is deterministic', () => {
    expect(fp()).toBe(fp());
  });

  it('is a fixed-width hash that does not carry the address in the clear', () => {
    const value = fp();
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(value).not.toContain('Main');
    expect(value).not.toContain('example.com');
  });
});
