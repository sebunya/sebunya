import { describe, expect, it } from 'vitest';
import { PopularNearYouUseCase, NEAR_YOU_MIN_BUYERS } from '../../apps/api/src/application/recommendations/PopularNearYouUseCase';
import type { INearbyDemandReader, NearbyScope } from '../../apps/api/src/application/ports/INearbyDemandReader';
import type { IProductRecommendationReader, RecommendationProductRecord } from '../../apps/api/src/application/ports/IProductRecommendationReader';

const product = (id: string, p: Partial<RecommendationProductRecord> = {}): RecommendationProductRecord => ({ id, slug: id, name: `P ${id}`, price: 10_000, stockQuantity: 5, isActive: true, isVisible: true, ...p });

function setup(byScope: Record<string, Array<{ productId: string; buyers: number }>>, records: RecommendationProductRecord[]) {
  const asked: NearbyScope[] = [];
  const demand: INearbyDemandReader = {
    topProducts: async (scope, input) => {
      asked.push(scope);
      expect(input.minBuyers).toBe(NEAR_YOU_MIN_BUYERS);
      const key = scope.kind === 'area' ? `area:${scope.areaSlug}` : scope.kind === 'district' ? `district:${scope.district}` : 'gk';
      return byScope[key] ?? [];
    },
  };
  const products = { findProductsByIds: async (ids: string[]) => records.filter((r) => ids.includes(r.id)) } as unknown as IProductRecommendationReader;
  return { uc: new PopularNearYouUseCase(demand, products), asked };
}

describe('Popular in <area>: what customers there actually bought', () => {
  it('answers from the area when it has enough evidence, titled with the area', async () => {
    const top = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ productId: id, buyers: 9 - i }));
    const { uc } = setup({ 'area:wakiso-najjera': top }, top.map((t) => product(t.productId)));
    const r = await uc.execute({ areaSlug: 'wakiso-najjera', areaName: 'Najjera', district: 'Wakiso' });
    expect(r.scopeLabel).toBe('Najjera');
    expect(r.items.map((i) => i.productId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.items[0].displayReason).toBe('9 Najjera customers bought this');
  });

  it('widens to the district, then Greater Kampala; never pads with unrelated products', async () => {
    const top = ['a', 'b', 'c', 'd'].map((id) => ({ productId: id, buyers: 3 }));
    const { uc, asked } = setup({ gk: top }, top.map((t) => product(t.productId)));
    const r = await uc.execute({ areaSlug: 'wakiso-najjera', areaName: 'Najjera', district: 'Wakiso' });
    expect(asked.map((a) => a.kind)).toEqual(['area', 'district', 'districts']);
    expect(r.scopeLabel).toBe('Greater Kampala');
    const none = await setup({}, []).uc.execute({ areaSlug: null, areaName: null, district: 'Gulu' });
    expect(none).toEqual({ scope: null, scopeLabel: null, items: [] });
  });

  it('shows only what can be bought now', async () => {
    const top = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ productId: id, buyers: 4 }));
    const { uc } = setup({ 'area:x-y-1': top }, [product('a'), product('b', { stockQuantity: 0 }), product('c', { isVisible: false }), product('d'), product('e'), product('f')]);
    const r = await uc.execute({ areaSlug: 'x-y-1', areaName: 'Y', district: 'Kampala' });
    expect(r.items.map((i) => i.productId)).toEqual(['a', 'd', 'e', 'f']);
  });
});
