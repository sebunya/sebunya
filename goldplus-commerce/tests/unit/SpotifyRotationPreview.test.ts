import { describe, expect, it } from 'vitest';
import { SpotifyRotationPreviewUseCase } from '../../apps/api/src/application/use-cases/advertising/SpotifyRotationPreview';
import type { SpotifyRotationReader } from '../../apps/api/src/application/ports/SpotifyRotation';

const NOW = new Date('2026-12-01T09:00:00Z');
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
const feed = (over: Record<string, unknown> = {}) => ({
  id: 'p1', sku: 'S1', slug: 'samsung-a15', name: 'Samsung Galaxy A15', shortDescription: 'Phone', priceUgx: 400_000,
  stockStatus: 'in_stock', stockQuantity: 5, reservedQuantity: 0, isPreOrderEnabled: false, imageUrl: '/uploads/a15/pdp.jpg',
  modelNumber: 'A15', isFeedEligible: true, active: true, approvalStatus: 'approved', ...over,
}) as any;
const reader = (facts: Partial<Awaited<ReturnType<SpotifyRotationReader['facts']>>>): SpotifyRotationReader => ({
  facts: async () => ({ events: {}, createdAt: {}, orders30d: {}, spotifyOrders30d: {}, historySince: null, ...facts }),
});

describe('Spotify rotation preview from live shop data', () => {
  it('a proven price drop becomes a Spotify ad with an absolute photo and a tagged product link', async () => {
    const uc = new SpotifyRotationPreviewUseCase(async () => [feed()], reader({
      events: { p1: [
        { at: day(-60), priceUgx: 450_000, stockStatus: 'in_stock', published: true, changed: ['BASELINE'] },
        { at: day(-2), priceUgx: 400_000, stockStatus: 'in_stock', published: true, changed: ['PRICE'] },
      ] },
      createdAt: { p1: day(-400) }, historySince: day(-60),
    }), () => NOW);
    const r = await uc.preview();
    expect(r.plan.actions).toHaveLength(1);
    const a = r.plan.actions[0] as any;
    expect(a).toMatchObject({ kind: 'CREATE', reason: 'PRICE_DROP', imageUrl: 'https://shopgoldplus.com/uploads/a15/pdp.jpg' });
    expect(a.tagline).toContain('UGX 400,000');
    expect(a.clickthroughUrl).toMatch(/^https:\/\/shopgoldplus\.com\/products\/samsung-a15\?utm_source=spotify/);
    expect(r.priceDropsProvableFrom).toBe(day(-30).toISOString());
  });

  it('before migration 0169 (no history) it claims no drop and says when drops become provable: never, yet', async () => {
    const uc = new SpotifyRotationPreviewUseCase(async () => [feed()], reader({ createdAt: { p1: day(-400) } }), () => NOW);
    const r = await uc.preview();
    expect(r.plan.actions).toEqual([]);
    expect(r.historySince).toBeNull();
    expect(r.priceDropsProvableFrom).toBeNull();
    expect(r.plan.nothingToAdvertise).toBe(true);
  });

  it('only what the catalogue feeds include, and only what can be bought now', async () => {
    const uc = new SpotifyRotationPreviewUseCase(async () => [
      feed({ id: 'nophoto', imageUrl: null }),
      feed({ id: 'sold', stockQuantity: 2, reservedQuantity: 2 }),
      feed({ id: 'fresh', slug: 'fresh' }),
    ], reader({ createdAt: { nophoto: day(-3), sold: day(-3), fresh: day(-3) }, orders30d: {} }), () => NOW);
    const r = await uc.preview();
    expect(r.productsConsidered).toBe(2); // the photo-less product is not in the feed at all
    expect(r.plan.actions.map((a) => a.productId)).toEqual(['fresh']);
    expect(r.plan.skipped.map((s) => s.productId)).toEqual(['sold']);
  });
});
