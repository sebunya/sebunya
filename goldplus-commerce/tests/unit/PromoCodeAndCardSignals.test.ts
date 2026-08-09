import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Promo-code entry + product-card commercial signals (2026-08-10).
 *
 * The coupon machinery (evaluator couponCode, single-use redemption, the
 * checkout schema) existed with NOWHERE to type a code. These contracts pin the
 * operator-facing closure: a real input at checkout, a preview priced by the
 * SAME evaluator that charges, and a card that tells the truth about stock and
 * about when a sale price ends.
 */
const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const checkout = read('apps/web/src/pages/checkout.astro');
const card = read('apps/web/src/components/ProductCard.astro');
const commerce = read('apps/api/src/interfaces/http/routes/commerce.ts');

describe('promo-code entry at checkout', () => {
  it('the page has a real code input bound to the checkout form, plus the preview quote field', () => {
    expect(checkout).toContain('id="couponCode"');
    expect(checkout).toContain('name="couponCode"');
    expect(checkout).toContain('form="checkout-form"');
    expect(checkout).toContain('id="previewQuoteId"');
    expect(checkout).toContain('id="promo-apply"');
  });

  it('the submitted order carries the code and the preview quote id (server-validated)', () => {
    expect(checkout).toContain("formData.get('couponCode')");
    expect(checkout).toContain('couponCode: cc');
    expect(checkout).toContain("formData.get('previewQuoteId')");
    expect(checkout).toContain('previewQuoteId: q');
  });

  it('the preview endpoint prices with the SAME evaluator, twice, and reports the truthful delta', () => {
    expect(commerce).toContain("routes.post('/pricing-preview'");
    // baseline without the code, then with it — the delta is the coupon effect
    expect(commerce).toContain('couponCode: null, persist: false');
    expect(commerce).toContain('quote.discountTotalUgx - base.discountTotalUgx');
    // unknown/unqualified code is a truthful zero with a reason, never invented
    expect(commerce).toContain("doesn't match a live offer");
    // server-priced: items are id+quantity only; client prices are never read
    expect(commerce).toMatch(/pricing-preview[\s\S]{0,900}quantity: Number\(i\?\.quantity\)/);
  });

  it('an applied preview lowers only the GOODS total; the confirmed-fee contract is untouched', () => {
    expect(checkout).toContain('const goodsTotal = () => Math.max(0, subtotal - promoDiscountUgx)');
    expect(checkout).toContain('ugx(goodsTotal() + est.feeUgx)');
  });
});

describe('product-card commercial signals', () => {
  it('shows the REAL stock count whenever a product is in stock, amber only when low', () => {
    expect(card).toContain('Only ${stockCount} left in stock');
    expect(card).toContain('${stockCount} in stock');
    // the count comes from tracked availability, never invented
    expect(card).toContain("product.availability.kind === 'in_stock' && product.availability.quantity > 0");
  });

  it('counts down to the sale end and says plainly when the regular price returns', () => {
    expect(card).toContain('data-card-sale-ends={discount.endsIso}');
    expect(card).toContain('Sale ends in');
    expect(card).toContain('Sale ended — regular price applies');
  });

  it('the PDP countdown is SCOPED to its own attribute — it can never touch the header', () => {
    // The header element (<header id="gpNav">) carries data-sale-ends for the
    // flash-sale strip. A bare [data-sale-ends] query on the PDP matched the
    // header FIRST, and textContent then wiped the ENTIRE navigation on every
    // product page. The PDP owns data-pdp-sale-ends; the header keeps its name.
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect(pdp).toContain('data-pdp-sale-ends');
    expect(pdp).not.toContain("querySelector('[data-sale-ends]')");
    const nav = read('apps/web/src/components/GpNav.astro');
    expect(nav).toContain('data-sale-ends={saleEnds}');
    // The card ticker likewise uses its own attribute.
    expect(card).not.toContain("querySelector('[data-sale-ends]')");
  });

  it('sale price still mirrors the evaluator formula (display equals charge)', () => {
    expect(card).toContain('salePriceUgx(product.retailPriceUgx!, discount.percentBps)');
    const lib = read('apps/web/src/lib/storefrontDiscount.ts');
    expect(lib).toContain('Math.floor((regularUgx * percentBps) / 10_000)');
  });
});
