import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { salePriceUgx } from '../../apps/web/src/lib/storefrontDiscount';
import { STOREFRONT_PRICE_FLOOR_UGX } from '../../packages/shared/src/batteries';

/**
 * A running campaign is not the same thing as money off THIS basket.
 *
 * The evaluator will not discount below the per-unit price floor. With the
 * floor at UGX 145,000 and products priced AT the floor, "10% off everything"
 * takes off nothing, yet the cart, the checkout summary, the product page and
 * every product card still announced a discount. The checkout summary read
 * "10% discount · Launch offer   -UGX 0", which is a claim the shop does not
 * honour. A sale is only ever shown when the price actually drops.
 */
const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('the floor can swallow a discount entirely', () => {
  it('takes nothing off a product priced at the floor', () => {
    const atFloor = STOREFRONT_PRICE_FLOOR_UGX;
    expect(salePriceUgx(atFloor, 1000, STOREFRONT_PRICE_FLOOR_UGX)).toBe(atFloor);
  });

  it('still discounts a product priced above the floor, down to the floor', () => {
    expect(salePriceUgx(185_000, 1000, STOREFRONT_PRICE_FLOOR_UGX)).toBe(166_500);
    // A deep cut stops exactly at the floor, never below it.
    expect(salePriceUgx(185_000, 9000, STOREFRONT_PRICE_FLOOR_UGX)).toBe(STOREFRONT_PRICE_FLOOR_UGX);
  });
});

describe('no surface claims a sale it does not give', () => {
  it('gates the checkout summary row on a real saving', () => {
    const src = read('apps/web/src/pages/checkout.astro');
    expect(src).toMatch(/const checkoutOnSale = campaignRunning && checkoutSavings > 0/);
    // The row itself must still be driven by that gate.
    expect(src).toMatch(/\{checkoutOnSale && \(/);
  });

  it('gates the cart summary row on a real saving', () => {
    const src = read('apps/web/src/pages/cart.astro');
    expect(src).toMatch(/const cartOnSale = cartCampaignRunning && cartSavings > 0/);
  });

  it('gates the product page on a price that actually drops', () => {
    const src = read('apps/web/src/pages/products/[slug].astro');
    expect(src).toMatch(/const pdpOnSale = pdpCampaignRunning && pdpSaleUgx !== null && pdpSaleUgx < product!\.retailPriceUgx!/);
  });

  it('gates the product card on a price that actually drops', () => {
    const src = read('apps/web/src/components/ProductCard.astro');
    expect(src).toMatch(/const onSale = campaignRunning && saleUgx !== null && saleUgx < product\.retailPriceUgx!/);
  });

  it('gates the header featured card on a price that actually drops', () => {
    // The header was missed by the original sweep: it said "On sale now" and
    // printed "UGX 145,000 -> UGX 145,000" for a product priced at the floor.
    const src = read('apps/web/src/components/GpNav.astro');
    expect(src).toMatch(/const dealFeatOnSale =\s*\n?\s*dealFeatSaleUgx !== null && dealFeat\?\.priceUgx != null && dealFeatSaleUgx < dealFeat\.priceUgx;/);
    // Both the words and the price row hang off the saving, not the campaign.
    expect(src).toMatch(/\{dealFeatOnSale \? 'On sale now'/);
    expect(src).toMatch(/\{dealFeatOnSale \? \(/);
    expect(src).not.toMatch(/navDeal\.active \? 'On sale now'/);
  });

  it('never lets a surface treat "campaign active" as "discount given"', () => {
    // The defect shape: deciding to show a sale straight from the campaign
    // flags, with no comparison against the discounted figure.
    for (const file of [
      'apps/web/src/pages/checkout.astro',
      'apps/web/src/pages/cart.astro',
      'apps/web/src/pages/products/[slug].astro',
      'apps/web/src/components/ProductCard.astro',
      'apps/web/src/components/GpNav.astro',
    ]) {
      const src = read(file);
      const bad = /const \w*[Oo]nSale\s*=\s*[^;\n]*percentBps > 0\s*(?:&&\s*[\w.]+\s*>\s*0\s*)?;/.exec(src);
      expect(bad?.[0], `${file} decides a sale from the campaign alone: ${bad?.[0]}`).toBeUndefined();
    }
  });
});
