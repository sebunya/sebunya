import { describe, expect, it } from 'vitest';
import { SpotifyRotationPreviewUseCase } from '../../apps/api/src/application/use-cases/advertising/SpotifyRotationPreview';
import type { SpotifyRotationReader, FeaturedProductsStore } from '../../apps/api/src/application/ports/SpotifyRotation';

const store = (initial: string[] = []) => { let ids = [...initial]; return { list: async () => [...ids], replace: async (_p: string, next: string[]) => { ids = [...next]; } } as FeaturedProductsStore; };

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
    }), store(), null, () => NOW);
    const r = await uc.preview();
    expect(r.plan.actions).toHaveLength(1);
    const a = r.plan.actions[0] as any;
    expect(a).toMatchObject({ kind: 'CREATE', reason: 'PRICE_DROP', imageUrl: 'https://shopgoldplus.com/uploads/a15/pdp.jpg' });
    expect(a.tagline).toContain('UGX 400,000');
    expect(a.clickthroughUrl).toMatch(/^https:\/\/shopgoldplus\.com\/products\/samsung-a15\?utm_source=spotify/);
    expect(r.priceDropsProvableFrom).toBe(day(-30).toISOString());
  });

  it('before migration 0169 (no history) it claims no drop and says when drops become provable: never, yet', async () => {
    const uc = new SpotifyRotationPreviewUseCase(async () => [feed()], reader({ createdAt: { p1: day(-400) } }), store(), null, () => NOW);
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
    ], reader({ createdAt: { nophoto: day(-3), sold: day(-3), fresh: day(-3) }, orders30d: {} }), store(), null, () => NOW);
    const r = await uc.preview();
    expect(r.productsConsidered).toBe(2); // the photo-less product is not in the feed at all
    expect(r.plan.actions.map((a) => a.productId)).toEqual(['fresh']);
    expect(r.plan.skipped.map((s) => s.productId)).toEqual(['sold']);
  });
});

describe('the reader counts a sale the way the rest of advertising does', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const read = (f: string) => readFileSync(join(__dirname, '../..', f), 'utf8');
  it('delivered or completed (COD), or paid and not cancelled or failed: never "paid" alone', () => {
    const PRED = "o.status in ('delivered', 'completed') or (o.payment_status = 'paid' and o.status not in ('cancelled', 'failed'))";
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository.ts')).toContain(PRED);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleSpotifyRotationReader.ts')).toContain(PRED);
  });
});

describe('featured products: the owner\'s choice is a reason, and claims nothing', () => {
  const old = (id: string, name: string) => feed({ id, slug: id, name });
  const facts = reader({ createdAt: { a: day(-400), b: day(-400) } });

  it('a featured product is advertised with name and price only, no "New in" or "Price drop"', async () => {
    const uc = new SpotifyRotationPreviewUseCase(async () => [old('a', 'Oraimo Power Bank 20000mAh')], facts, store(['a']), null, () => NOW);
    const r = await uc.preview();
    const a = r.plan.actions[0] as any;
    expect(a).toMatchObject({ kind: 'CREATE', reason: 'FEATURED' });
    expect(a.tagline).toBe('Oraimo Power Bank 20000mAh, UGX 400,000');
    expect(a.why).toContain('chosen by the owner');
    expect(r.candidates.find((c) => c.productId === 'a')!.featured).toBe(true);
  });

  it('saving is limited to feed products, at most 10, each once, and is audited', async () => {
    const s = store();
    const audits: any[] = [];
    const uc = new SpotifyRotationPreviewUseCase(async () => [old('a', 'A'), old('b', 'B'), feed({ id: 'hidden', imageUrl: null })], facts, s, { execute: async (x: any) => { audits.push(x); return {} as any; } }, () => NOW);
    expect(await uc.setFeatured('u1', ['a', 'a', 'b'])).toEqual({ ok: true, featured: ['a', 'b'] });
    expect(await s.list('spotify')).toEqual(['a', 'b']);
    expect(audits[0]).toMatchObject({ actorId: 'u1', action: 'AD_FEATURED_PRODUCTS_SET', oldState: { productIds: [] }, newState: { productIds: ['a', 'b'] } });
    expect(await uc.setFeatured('u1', ['hidden'])).toMatchObject({ ok: false, message: expect.stringContaining('Not in the catalogue feed') });
    expect(await uc.setFeatured('u1', Array.from({ length: 11 }, (_, i) => `x${i}`))).toMatchObject({ ok: false, message: 'At most 10 featured products.' });
    expect(await uc.setFeatured('u1', 'a')).toMatchObject({ ok: false });
  });

  it('news still wins a slot first: a new arrival outranks a featured product', async () => {
    const uc = new SpotifyRotationPreviewUseCase(async () => [old('a', 'Featured One'), feed({ id: 'n', slug: 'n', name: 'New One' })],
      reader({ createdAt: { a: day(-400), n: day(-2) } }), store(['a']), null, () => NOW);
    const r = await uc.preview(1);
    expect(r.plan.actions.map((x) => x.productId)).toEqual(['n']);
  });
});

describe('migration 0170', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  it('creates ad_featured_products keyed by platform and product, and is registered', () => {
    const sql = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/migrations/0170_ad_featured_products.sql'), 'utf8');
    expect(sql).toMatch(/PRIMARY KEY \(platform, product_id\)/);
    expect(readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/migrations/meta/_journal.json'), 'utf8')).toContain('"tag": "0170_ad_featured_products"');
  });
});
