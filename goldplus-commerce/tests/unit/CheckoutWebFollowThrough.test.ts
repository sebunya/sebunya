import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offersOnlinePayment } from '../../packages/shared/src/types/account';
import { cartLineHref } from '../../apps/web/src/lib/cart';

/**
 * The storefront half of the payment and cart fixes whose API half is already
 * in place (sweep, group 0 findings 2/5/6, group 1 #0/#1/#3). The .astro pages
 * are not type-checked in their markup, so their contracts are pinned from the
 * source, next to the helpers they rely on.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const checkout = read('apps/web/src/pages/checkout.astro');

describe('the checkout intent is used up when its order settles', () => {
  const callback = read('apps/web/src/pages/checkout/pesapal/callback.astro');

  it('the PesaPal return clears the intent on success and on already-settled', () => {
    expect(callback).toContain("import { clearCheckoutIntent } from '../../../lib/checkoutIntent';");
    const settled = callback.slice(callback.indexOf("if (kind === 'success' || kind === 'already_settled') {"));
    const block = settled.slice(0, settled.indexOf('\n}\n'));
    expect(block).toContain("Astro.cookies.delete('goldplus_cart_data', { path: '/' });");
    expect(block).toContain('clearCheckoutIntent(Astro.cookies);');
    // Only there: a pending or failed return keeps the intent for the retry.
    expect(callback.match(/clearCheckoutIntent\(/g)?.length).toBe(1);
  });
});

describe('an already-ordered resubmit keeps the new basket', () => {
  it('does not clear the basket in the CHECKOUT_ALREADY_ORDERED branch', () => {
    const branch = checkout.slice(checkout.indexOf("result.code === 'CHECKOUT_ALREADY_ORDERED'"), checkout.indexOf("result.code === 'STOCK_NOT_RESERVED'"));
    expect(branch.length).toBeGreaterThan(100);
    expect(branch).not.toContain('clearBasketAfterOrder');
  });
});

describe('a refused checkout re-renders with the promo code', () => {
  it('the code and its preview are read from the submitted form', () => {
    expect(checkout).toMatch(/couponCodeValue = String\(formData\.get\('couponCode'\) \|\| ''\)\.trim\(\)\.slice\(0, 40\);/);
    expect(checkout).toMatch(/previewQuoteIdValue = \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(q\) \? q : '';/);
  });

  it('both are written back into the form', () => {
    const input = checkout.slice(checkout.indexOf('id="couponCode"'), checkout.indexOf('/>', checkout.indexOf('id="couponCode"')));
    expect(input).toContain('value={couponCodeValue}');
    expect(checkout).toContain('<input type="hidden" id="previewQuoteId" name="previewQuoteId" form="checkout-form" value={previewQuoteIdValue} />');
  });

  it('a price or offer refusal drops the stale preview (a retry under it would be refused the same way)', () => {
    expect(checkout).toMatch(/if \(!result\.ok && \(result\.code === 'PRICE_CHANGED' \|\| result\.code === 'PROMOTION_CHANGED'\)\) \{\s*previewQuoteIdValue = '';/);
  });

  it('a carried code is checked again on load, so the summary shows its discount', () => {
    expect(checkout).toContain('if (promoInput?.value.trim()) promoApply?.click();');
  });
});

describe('the estimate asks the one quoting service what the order will be charged', () => {
  it('the saved-address estimate sends district, area, area slug and the basket', () => {
    expect(checkout).toContain("const estimateItemsParam = cart.items.map((i) => `${i.productId}:${i.quantity}`).join(',');");
    const ssr = checkout.slice(checkout.indexOf('/commerce/delivery-estimate?district='), checkout.indexOf('signal: AbortSignal.timeout(2500)', checkout.indexOf('/commerce/delivery-estimate?district=')));
    expect(ssr).toContain('&area=${encodeURIComponent(defaultAddress.areaDetails');
    expect(ssr).toContain('&areaSlug=${encodeURIComponent(defaultAddress.areaSlug');
    expect(ssr).toContain('&items=${encodeURIComponent(estimateItemsParam)}');
  });

  it('the live estimate forwards the area slug and the basket', () => {
    const fn = checkout.slice(checkout.indexOf('async function refreshEstimate('), checkout.indexOf('await fetch(`${API_BASE}/commerce/delivery-estimate'));
    expect(fn).toContain('areaSlug: string | null = null');
    expect(fn).toContain('...(areaSlug ? { areaSlug } : {})');
    expect(fn).toContain('...(estimateItems ? { items: estimateItems } : {})');
    expect(checkout).toContain('refreshEstimate(r.dataset.district ?? null, r.dataset.area || null, r.dataset.areaSlug || null)');
    expect(checkout).toContain("refreshEstimate(String(loc.district), loc.area ?? null, loc.areaSlug ? String(loc.areaSlug) : null)");
  });

  it('each saved address carries its area and slug, and the order is charged on the same key', () => {
    expect(checkout).toContain('data-area={a.areaDetails}');
    expect(checkout).toContain("data-area-slug={a.areaSlug ?? ''}");
    expect(checkout).toContain('areaSlug?: string | null;');
    expect(checkout).toContain('deliveryLocation: { district: selectedAddress.district, areaSlug: selectedAddress.areaSlug ?? undefined },');
  });
});

describe('cart lines link to their product only when the slug is known', () => {
  const cart = read('apps/web/src/pages/cart.astro');

  it('the server basket line keeps the slug the API returns', () => {
    expect(read('apps/web/src/lib/cartClient.ts')).toMatch(/interface CartLineView \{[^}]*slug\?: string;/);
    expect(cart).toContain("slug: line.slug ?? '',");
    expect(cart).not.toMatch(/productId: line\.productId,\s*slug: '',/);
  });

  it('an empty slug gives no link (never /products/), a real one gives the product page', () => {
    expect(cartLineHref('')).toBeNull();
    expect(cartLineHref(undefined)).toBeNull();
    expect(cartLineHref('generic-fast-charger')).toBe('/products/generic-fast-charger');
    expect(cart).toMatch(/\{view\.href \? \(\s*<a href=\{view\.href\}/);
  });
});

describe('"Pay for this order" on the account order list', () => {
  const list = read('apps/web/src/pages/account/orders.astro');

  it('uses the shared rule, not a status nothing writes', () => {
    expect(list).toContain("import { offersOnlinePayment } from '@goldplus/shared';");
    expect(list).toContain('{offersOnlinePayment(o) ? (');
    expect(list).not.toContain("'PENDING_PAYMENT'");
  });

  it('a received order whose PesaPal payment failed is offered payment; paid and cash-on-delivery are not', () => {
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'failed', paymentMethod: 'pesapal' })).toBe(true);
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'paid', paymentMethod: 'pesapal' })).toBe(false);
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'unpaid', paymentMethod: 'offline' })).toBe(false);
  });

  it('track-order and the order page decide from the payment status as well', () => {
    expect(read('apps/web/src/pages/orders/[id].astro')).toContain('const isUnpaid = order ? offersOnlinePayment(order) : false;');
    expect(read('apps/web/src/pages/track-order.astro')).toMatch(/const isUnpaid = Boolean\(order\) && orderAwaitsPayment\(\{ status: order\?\.orderStatus, paymentStatus: order\?\.paymentStatus/);
  });
});
