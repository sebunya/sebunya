import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { salePriceUgx } from '../../apps/web/src/lib/storefrontDiscount';

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
    // ONE ticker owns every chip, in BaseLayout — rails inject cards on any page.
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('Sale ends in');
    expect(layout).toContain('Sale ended. Regular price applies');
  });

  it('EVERY module renders the same commercial signals — rails are uniform with the card', () => {
    // The shared RecommendationCard (PopularNow / CompleteSetup / Related /
    // CartAddon / CategoryPopular rails and the cart page) carries sale price,
    // % pill, countdown chip and the honest stock count.
    const rec = read('apps/web/src/components/recommendations/RecommendationCard.astro');
    expect(rec).toContain('salePriceUgx(item.price!, discount.percentBps, discount.priceFloorUgx)');
    expect(rec).toContain('data-card-sale-ends={discount.endsIso}');
    expect(rec).toContain('Only ${stockCount} left in stock');
    expect(rec).toContain('${stockCount} in stock');

    // The client-built RecentlyViewedRail applies the SAME formula from the
    // server-stamped campaign (never a client-invented number). It now calls
    // the shared helper rather than restating the arithmetic, because the
    // restated copy had left out the campaign price floor.
    const rv = read('apps/web/src/components/recommendations/RecentlyViewedRail.astro');
    expect(rv).toContain('getStorefrontDiscount');
    expect(rv).toContain('salePriceUgx(regular, saleBps, saleFloor)');
    expect(rv).toContain('data-card-sale-ends=');
    expect(rv).toContain('Only ${qty} left in stock');

    // The spec-speak rail subtitle is gone from the PDP.
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect(pdp).not.toContain('clearly labelled catalogue fallback');
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

  it('EVERY card carries a real call to action — the same server-handled add/buy the PDP uses', () => {
    // ProductCard, RecommendationCard and the client-built rail all POST the
    // SAME /cart form (action=add, buyNow=1 goes straight to checkout); an
    // unbuyable product gets an honest "View product" link, never a dead button.
    const rec = read('apps/web/src/components/recommendations/RecommendationCard.astro');
    const rv = read('apps/web/src/components/recommendations/RecentlyViewedRail.astro');
    for (const [name, src] of [['ProductCard', card], ['RecommendationCard', rec], ['RecentlyViewedRail', rv]] as const) {
      expect(src, `${name} must post the canonical add form`).toContain('method="POST" action="/cart"');
      expect(src, `${name} must offer Buy now`).toContain('name="buyNow"');
      expect(src, `${name} must offer Add to cart`).toContain('Add to cart');
      expect(src, `${name} must degrade honestly when unbuyable`).toContain('View product');
    }
    // A form may never nest inside an anchor — the card wrappers are divs.
    expect(rec).not.toMatch(/<a[^>]*>\s*[\s\S]*<form[\s\S]*<\/form>[\s\S]*<\/a>\s*<\/li>/);
  });

  it('the PDP sells without detours — no Request quote, no Support & Trust block (owner decision)', () => {
    // 2026-08-10: the owner removed both. "Request quote" beside Add to
    // cart/Buy now confused regular customers (wholesale quoting lives at
    // /quote-request via the business pathways), and the Verify/Report trio is
    // unnecessary on our own storefront — those journeys stay in the footer
    // and support pages.
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect(pdp).not.toContain('Request quote');
    expect(pdp).not.toContain('SupportTrustStrip');
    expect(pdp).not.toContain('Support & Trust');
    const shop = read('apps/web/src/pages/shop.astro');
    expect(shop).not.toContain('SupportTrustStrip');
  });

  it('sale price still mirrors the evaluator formula (display equals charge)', () => {
    expect(card).toContain('salePriceUgx(product.retailPriceUgx!, discount.percentBps, discount.priceFloorUgx)');
    const lib = read('apps/web/src/lib/storefrontDiscount.ts');
    // The formula moved to @goldplus/shared so the API's Merchant Center feed
    // and every storefront surface use one copy; the lib re-exports it.
    // From the pricing LEAF by relative path: the package barrel reaches
    // node:crypto and this module is bundled for the browser, and a package.json
    // "exports" subpath broke how the API resolves the package at runtime.
    expect(lib).toContain("from '../../../../packages/shared/src/pricing/salePrice'");
  });

  it('every call site passes a floor, and the line-total ones scale it by quantity', () => {
    // A caller that forgets the floor advertises a price the evaluator will not
    // honour. The two basket callers discount a LINE, so their floor is
    // per-unit * quantity — exactly `priceFloorUgx * line.quantity` in
    // PricingEvaluator.
    for (const f of [
      'apps/web/src/components/ProductCard.astro',
      'apps/web/src/components/GpNav.astro',
      'apps/web/src/components/recommendations/RecommendationCard.astro',
      'apps/web/src/pages/cart.astro',
      'apps/web/src/pages/checkout.astro',
    ]) {
      const src = read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
      for (const call of src.match(/salePriceUgx\([^;]*?\)\s*(?=[,);:]|$)/gm) ?? []) {
        // three arguments: base, bps, floor
        expect(call.split(',').length).toBeGreaterThanOrEqual(3);
        expect(call).toMatch(/priceFloorUgx/);
      }
    }
    expect(read('apps/web/src/pages/cart.astro')).toContain('cartDiscount.priceFloorUgx * i.quantity');
    expect(read('apps/web/src/pages/checkout.astro')).toContain('checkoutDiscount.priceFloorUgx * i.quantity');
  });
});

describe('the displayed sale price cannot cross the promotion price floor', () => {
  /** PricingEvaluator L129-L134, per line, with no prior discount. */
  const evaluatorCharge = (base: number, bps: number, floor: number, qty: number) => {
    const available = Math.max(0, base - floor * qty);
    const desired = Math.floor((base * bps) / 10_000);
    return base - Math.min(available, desired);
  };

  it('agrees with the evaluator to the shilling across the catalogue', () => {
    const FLOOR = 145_000;
    for (const unit of [145_000, 149_000, 155_000, 159_000, 165_000, 175_000, 185_000, 150_000]) {
      for (const qty of [1, 2, 7]) {
        const base = unit * qty;
        expect(salePriceUgx(base, 1000, FLOOR * qty)).toBe(evaluatorCharge(base, 1000, FLOOR, qty));
        // The point of the floor: never a shilling under it.
        expect(salePriceUgx(base, 1000, FLOOR * qty)).toBeGreaterThanOrEqual(FLOOR * qty);
      }
    }
  });

  it('discounts normally when the floor is out of reach', () => {
    expect(salePriceUgx(500_000, 1000, 145_000)).toBe(450_000);
  });

  it('never discounts a price already at or under the floor', () => {
    expect(salePriceUgx(145_000, 1000, 145_000)).toBe(145_000);
    expect(salePriceUgx(100_000, 1000, 145_000)).toBe(100_000);
  });

  it('a zero floor behaves exactly as before', () => {
    expect(salePriceUgx(149_000, 1000, 0)).toBe(134_100);
  });
});
