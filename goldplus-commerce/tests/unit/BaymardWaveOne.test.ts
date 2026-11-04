import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Baymard wave 1 (docs/ux/BAYMARD.md): the storefront facts that the audit found missing and that this wave puts in.
 * Each is read from the page source, the way the demand-count test reads shop.astro, so a later edit that removes
 * one fails here with its name rather than quietly in a shopper's hands.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('checkout (K4, K6, K7, K11)', () => {
  const checkout = read('apps/web/src/pages/checkout.astro');

  it('the promo and gift-card fields sit behind one line that opens itself when a code was typed', () => {
    expect(checkout).toContain('<details id="codes-block"');
    expect(checkout).toMatch(/open=\{Boolean\(couponCodeValue \|\| storeCreditCodeValue\)\}/);
    const details = checkout.indexOf('<details id="codes-block"');
    expect(checkout.indexOf('id="promo-code-block"')).toBeGreaterThan(details);
    expect(checkout.indexOf('id="credit-code-block"')).toBeGreaterThan(details);
    expect(checkout.indexOf('</details>', details)).toBeGreaterThan(checkout.indexOf('id="credit-code-block"'));
  });

  it('email is marked optional and says what it is for', () => {
    expect(checkout).toMatch(/<FormField id="email"[^>]*\boptional\b/);
  });

  it('the pay button carries the security and returns line', () => {
    expect(checkout).toContain('id="pay-trust-line"');
    expect(checkout).toContain('never reach GoldPlus');
    expect(checkout).toContain('href="/returns"');
  });

  it('name, phone and email validate when the shopper leaves the field', () => {
    expect(checkout).toContain("field.addEventListener('blur'");
    for (const id of ['name', 'phone', 'email']) expect(checkout).toContain(`{ id: '${id}', check:`);
  });
});

describe('cart (C8, C10)', () => {
  const cart = read('apps/web/src/pages/cart.astro');

  it('phones get the total and the checkout button before the item list, and hear that no account is needed', () => {
    const top = cart.indexOf('data-cart-top-cta');
    expect(top).toBeGreaterThan(0);
    expect(cart.indexOf('aria-label="Cart items"')).toBeGreaterThan(top);
    expect(cart.slice(top, top + 1500)).toContain('No account needed');
  });

  it('the trust strip names the payment methods', () => {
    expect(cart).toContain('MTN or Airtel Mobile Money, Visa or Mastercard');
  });
});

describe('after the order (A4, A5, A7, A10)', () => {
  it('the confirmation page says what happens next', () => {
    const confirmed = read('apps/web/src/pages/checkout/confirmed.astro');
    expect(confirmed).toContain('What happens next');
  });

  it('a failed or cancelled payment email points at the order, where Pay now is, not at an empty checkout', () => {
    const messages = read('apps/api/src/application/notifications/CustomerMessages.ts');
    expect(messages).not.toContain('url: `${publicBaseUrl()}/checkout`');
    expect(messages).toMatch(/label: 'Try payment again', url: track/);
    expect(messages).toMatch(/label: 'Pay for this order', url: track/);
  });

  it('the track page no longer tells customers to call before a return', () => {
    expect(read('apps/web/src/pages/track-order.astro')).not.toContain('Contact support before returning an item');
  });

  it('the preferences page tells the truth about basket reminders', () => {
    const prefs = read('apps/web/src/pages/account/preferences.astro');
    expect(prefs).not.toContain('each stays off until you turn it on');
    expect(prefs).toContain('Basket reminders are on unless you switch them off');
  });
});

describe('product page and search (P5, Q8, Q10)', () => {
  it('the delivery quote prices the basket at the sale price', () => {
    expect(read('apps/web/src/pages/products/[slug].astro')).toContain('subtotalUgx={pdpSaleUgx ?? product.retailPriceUgx ?? 0}');
  });

  it('help words route to their pages and are not counted as stock demand; no results offers every finder', () => {
    const shop = read('apps/web/src/pages/shop.astro');
    for (const href of ['/returns', '/warranty', '/delivery', '/track-order', '/support']) expect(shop).toContain(`href: '${href}'`);
    expect(shop).toContain('if (!helpRoute) {');
    expect(shop).toContain('href="/charger-finder"');
    expect(shop).toContain('href="/product-finder"');
  });
});
