import { describe, expect, it } from 'vitest';
import { parseLocalCartCookie } from '../../apps/web/src/lib/cart';
import { CART_CREDENTIAL_TTL_SECONDS, CART_RETENTION_DAYS } from '../../packages/shared/src/cart-credential';

/**
 * RC-6 regression (do-not-break ledger #6): the cart page consumes `unitPriceUgx` and
 * `slug`; a parser that emits only `priceUgx` renders every price as `UShNaN` and every
 * line link as `/products/`. Plus the V4 §11 retention contract: ONE 180-day constant
 * drives both the credential cookie and the server row expiry.
 */
describe('local cart cookie parse (RC-6)', () => {
  it('emits unitPriceUgx alongside priceUgx and preserves slug', () => {
    const items = parseLocalCartCookie(
      JSON.stringify([{ productId: 'p-1', name: 'Charger', priceUgx: 50000, quantity: 2, slug: 'generic-fast-charger' }]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].unitPriceUgx).toBe(50000);
    expect(items[0].priceUgx).toBe(50000);
    expect(items[0].slug).toBe('generic-fast-charger');
  });

  it('accepts legacy items keyed by unitPriceUgx only', () => {
    const items = parseLocalCartCookie(JSON.stringify([{ productId: 'p-2', unitPriceUgx: 12345, quantity: 1 }]));
    expect(items[0].priceUgx).toBe(12345);
    expect(items[0].unitPriceUgx).toBe(12345);
  });

  it('returns [] for invalid JSON and non-arrays', () => {
    expect(parseLocalCartCookie('not-json')).toEqual([]);
    expect(parseLocalCartCookie(JSON.stringify({ productId: 'x' }))).toEqual([]);
    expect(parseLocalCartCookie(undefined)).toEqual([]);
  });
});

describe('guest-basket retention (V4 §11)', () => {
  it('retains guest baskets for 180 days, cookie and row from one constant', () => {
    expect(CART_RETENTION_DAYS).toBe(180);
    expect(CART_CREDENTIAL_TTL_SECONDS).toBe(180 * 24 * 60 * 60);
  });
});
