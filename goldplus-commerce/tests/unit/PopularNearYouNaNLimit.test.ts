import { describe, expect, it } from 'vitest';
import { PopularNearYouUseCase } from '../../apps/api/src/application/recommendations/PopularNearYouUseCase';

describe('/recommendations/near-you limit', () => {
  it.each([[NaN, 18], [Infinity, 18], [100, 36], [0, 3], [2.7, 6]])('limit %s asks the store for a finite %s', async (limit, expected) => {
    const asked: number[] = [];
    const uc = new PopularNearYouUseCase(
      { topProducts: async (_s: unknown, i: { limit: number }) => { asked.push(i.limit); return []; } } as never,
      { findProductsByIds: async () => [] } as never,
    );
    await uc.execute({ areaSlug: 'ntinda', areaName: null, district: null, limit });
    expect(asked[0]).toBe(expected);
  });
});
