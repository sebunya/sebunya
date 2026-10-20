import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isBundleShape, ProductBundlesUseCase } from '../../apps/api/src/application/use-cases/pricing/ProductBundlesUseCase';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const version = (conditions: any[], extra: any = {}) => ({
  conditions, benefits: [{ type: 'PERCENTAGE_OFF', value: 1000, targetProductIds: [A, B] }], couponCode: null,
  schedule: { startsAt: new Date('2026-10-01'), endsAt: new Date('2026-11-01') }, ...extra,
});
const PRICE: Record<string, number> = { [A]: 110_000, [B]: 20_000, [C]: 5_000 };

describe('bundles (gap #9)', () => {
  it('a bundle is two or more product conditions, no coupon, a benefit', () => {
    expect(isBundleShape(version([{ type: 'PRODUCT_INCLUDED', value: A }, { type: 'PRODUCT_INCLUDED', value: B }]))).toBe(true);
    expect(isBundleShape(version([{ type: 'PRODUCT_INCLUDED', value: A }]))).toBe(false);
    expect(isBundleShape(version([{ type: 'PRODUCT_INCLUDED', value: A }, { type: 'MIN_CART_SUBTOTAL', value: 1 }]))).toBe(false);
    expect(isBundleShape(version([{ type: 'PRODUCT_INCLUDED', value: A }, { type: 'PRODUCT_INCLUDED', value: B }], { couponCode: 'SAVE' }))).toBe(false);
  });

  it('shows the evaluator\'s together price against the products priced alone, for every product in it', async () => {
    const active = [{ definition: { id: 'p1', name: 'Power pair' }, version: version([{ type: 'PRODUCT_INCLUDED', value: A }, { type: 'PRODUCT_INCLUDED', value: B }]) }];
    const uc = new ProductBundlesUseCase({ listActiveVersions: async () => active as never }, async (items) => {
      const sum = items.reduce((s, i) => s + PRICE[i.productId], 0);
      // The evaluator applies 10% to A and B only when both are present.
      return { goodsUgx: items.length === 2 ? Math.round(sum * 0.9) : sum };
    });
    const r = await uc.forProduct(B);
    expect(r).toEqual([{ promotionId: 'p1', name: 'Power pair', productIds: [A, B], togetherUgx: 117_000, separatelyUgx: 130_000, savingUgx: 13_000, endsAt: '2026-11-01T00:00:00.000Z' }]);
    expect(await uc.forProduct(C)).toEqual([]);
  });

  it('a bundle the evaluator gives nothing for (a floor absorbed it) is not shown', async () => {
    const active = [{ definition: { id: 'p1', name: 'x' }, version: version([{ type: 'PRODUCT_INCLUDED', value: A }, { type: 'PRODUCT_INCLUDED', value: B }]) }];
    const uc = new ProductBundlesUseCase({ listActiveVersions: async () => active as never }, async (items) => ({ goodsUgx: items.reduce((s, i) => s + PRICE[i.productId], 0) }));
    expect(await uc.forProduct(A)).toEqual([]);
  });

  it('staff create it in Admin > Pricing by SKU, never with a coupon; the product page shows it', () => {
    const admin = readFileSync(new URL('../../apps/web/src/pages/admin/pricing/index.astro', import.meta.url), 'utf8');
    expect(admin).toContain("...bundleIds.map((id) => ({ type: 'PRODUCT_INCLUDED', value: id })),");
    expect(admin).toContain('A bundle applies automatically, so it cannot have a coupon code.');
    expect(readFileSync(new URL('../../apps/web/src/pages/products/[slug].astro', import.meta.url), 'utf8')).toContain('data-bundle-add=');
  });
});
