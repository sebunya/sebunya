import { describe, expect, it } from 'vitest';
import {
  planSpotifyRotation, taglineFor, rotationReason, isGenuinePriceDrop, unadvertisable, clickthroughUrl,
  TAGLINE_MAX, type RotationProduct, type RotationAd,
} from '../../apps/api/src/domain/advertising/SpotifyAdRotation';

const NOW = new Date('2026-10-06T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const product = (over: Partial<RotationProduct> = {}): RotationProduct => ({
  productId: 'p1', name: 'Samsung Galaxy A15 128GB', priceUgx: 450_000, priorLowestUgx30d: 450_000,
  published: true, inStock: true, url: 'https://shopgoldplus.com/products/samsung-a15', imageUrl: 'https://shopgoldplus.com/media/a15/pdp.jpg',
  firstPublishedAt: daysAgo(200), restockedAt: null, orders30d: 0, ...over,
});
const ad = (over: Partial<RotationAd> = {}): RotationAd => ({ adId: 'ad1', productId: 'p1', tagline: 'x', status: 'ACTIVE', startedAt: daysAgo(10), ...over });
const plan = (products: RotationProduct[], ads: RotationAd[] = [], spotify: Record<string, number> = {}, maxActive = 3) =>
  planSpotifyRotation({ products, ads, spotifyOrders30d: spotify, now: NOW, maxActive });

describe('honest reasons only', () => {
  it('a price drop must beat the LOWEST price of the 30 days before it', () => {
    expect(isGenuinePriceDrop({ priceUgx: 400_000, priorLowestUgx30d: 450_000 })).toBe(true);
    // raised to 500k last week, back to 450k: not a drop
    expect(isGenuinePriceDrop({ priceUgx: 450_000, priorLowestUgx30d: 450_000 })).toBe(false);
    expect(isGenuinePriceDrop({ priceUgx: 400_000, priorLowestUgx30d: null })).toBe(false);
  });

  it('new in for 21 days, back in stock for 7, best seller only with real orders, otherwise nothing', () => {
    expect(rotationReason(product({ firstPublishedAt: daysAgo(20) }), NOW)).toBe('NEW_ARRIVAL');
    expect(rotationReason(product({ firstPublishedAt: daysAgo(22) }), NOW)).toBeNull();
    expect(rotationReason(product({ restockedAt: daysAgo(6) }), NOW)).toBe('BACK_IN_STOCK');
    expect(rotationReason(product({ restockedAt: daysAgo(8) }), NOW)).toBeNull();
    expect(rotationReason(product({ orders30d: 3 }), NOW)).toBe('BEST_SELLER');
    expect(rotationReason(product({ priceUgx: 399_000, firstPublishedAt: daysAgo(1) }), NOW)).toBe('PRICE_DROP');
  });

  it('an out-of-stock, unpublished, photo-less or priceless product is never advertised', () => {
    expect(unadvertisable(product())).toBeNull();
    expect(unadvertisable(product({ inStock: false }))).toMatch(/out of stock/);
    expect(unadvertisable(product({ published: false }))).toMatch(/not published/);
    expect(unadvertisable(product({ imageUrl: null }))).toMatch(/photo/);
    expect(unadvertisable(product({ priceUgx: 0 }))).toMatch(/price/);
    expect(unadvertisable(undefined)).toMatch(/no longer exists/);
  });
});

describe('the headline', () => {
  it('fits Spotify\'s 40 characters, states the current price, and never invents urgency', () => {
    const t = taglineFor(product({ priceUgx: 399_000 }), 'PRICE_DROP');
    expect(t.length).toBeLessThanOrEqual(TAGLINE_MAX);
    expect(t).toContain('Price drop');
    expect(t).not.toMatch(/only|left|hurry|today only|last chance|\d+ in stock/i);
    for (const r of ['PRICE_DROP', 'BACK_IN_STOCK', 'NEW_ARRIVAL', 'BEST_SELLER', null] as const) {
      expect(taglineFor(product({ name: 'Hikvision 4MP ColorVu Bullet Camera with Built-in Mic and Strobe Light' }), r).length).toBeLessThanOrEqual(TAGLINE_MAX);
    }
  });

  it('shortens a long name at a word boundary, never mid-word, keeping at least two words', () => {
    const t = taglineFor(product({ name: 'Hikvision ColorVu Bullet Camera 4MP Outdoor' }), 'NEW_ARRIVAL');
    expect(t.startsWith('New in: Hikvision ColorVu')).toBe(true);
    const name = t.replace(/^New in: /, '').replace(/, UGX [\d,]+$/, '');
    expect('Hikvision ColorVu Bullet Camera 4MP Outdoor'.startsWith(name)).toBe(true);
    expect(name.split(' ').length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic, so an unchanged ad is never rewritten', () => {
    expect(taglineFor(product(), 'BEST_SELLER')).toBe(taglineFor(product(), 'BEST_SELLER'));
  });

  it('the click-through carries Spotify UTM tags naming the product', () => {
    const u = new URL(clickthroughUrl(product()));
    expect(u.searchParams.get('utm_source')).toBe('spotify');
    expect(u.searchParams.get('utm_content')).toBe('p1');
    expect(u.origin + u.pathname).toBe('https://shopgoldplus.com/products/samsung-a15');
  });
});

describe('the rotation plan', () => {
  it('fills free slots with the strongest reasons first', () => {
    const r = plan([
      product({ productId: 'best', name: 'Tecno Spark 20', orders30d: 9 }),
      product({ productId: 'drop', name: 'Infinix Hot 40', priceUgx: 380_000, priorLowestUgx30d: 420_000 }),
      product({ productId: 'new', name: 'Oraimo FreePods 4', firstPublishedAt: daysAgo(3) }),
      product({ productId: 'none', name: 'Old cable' }),
    ], [], {}, 2);
    expect(r.actions.map((a) => a.kind === 'CREATE' && a.productId)).toEqual(['drop', 'new']);
    expect(r.actions.every((a) => a.kind !== 'CREATE' || a.clickthroughUrl.includes('utm_source=spotify'))).toBe(true);
  });

  it('pauses an ad the moment its product goes out of stock, even if nothing replaces it', () => {
    const r = plan([product({ inStock: false })], [ad()]);
    expect(r.actions).toEqual([{ kind: 'PAUSE', adId: 'ad1', productId: 'p1', why: 'Paused: the product is out of stock.' }]);
    expect(r.nothingToAdvertise).toBe(true);
  });

  it('rewrites a running headline when the price changes', () => {
    const p = product({ orders30d: 2 });
    const old = taglineFor(p, 'BEST_SELLER');
    const r = plan([{ ...p, priceUgx: 470_000, priorLowestUgx30d: 450_000 }], [ad({ tagline: old })]);
    const u = r.actions.find((a) => a.kind === 'UPDATE_TAGLINE');
    expect(u && u.kind === 'UPDATE_TAGLINE' && u.to).toContain('UGX 470,000');
  });

  it('leaves a correct running ad alone', () => {
    const p = product({ orders30d: 2 });
    expect(plan([p], [ad({ tagline: taglineFor(p, 'BEST_SELLER') })]).actions).toEqual([]);
  });

  it('resumes a paused ad for a product rather than creating a duplicate', () => {
    const r = plan([product({ restockedAt: daysAgo(1) })], [ad({ status: 'PAUSED' })]);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ kind: 'RESUME', adId: 'ad1', reason: 'BACK_IN_STOCK' });
  });

  it('when full, swaps at most one weak ad (7+ days, no Spotify order) for a stronger reason', () => {
    const a = product({ productId: 'a', name: 'Item A', orders30d: 1 });
    const b = product({ productId: 'b', name: 'Item B', orders30d: 1 });
    const drop = product({ productId: 'd', name: 'Item D', priceUgx: 100_000, priorLowestUgx30d: 150_000 });
    const drop2 = product({ productId: 'e', name: 'Item E', priceUgx: 100_000, priorLowestUgx30d: 150_000 });
    const ads = [ad({ adId: 'A', productId: 'a', tagline: taglineFor(a, 'BEST_SELLER') }), ad({ adId: 'B', productId: 'b', tagline: taglineFor(b, 'BEST_SELLER') })];
    const r = plan([a, b, drop, drop2], ads, { b: 1 }, 2);
    expect(r.actions.map((x) => x.kind)).toEqual(['PAUSE', 'CREATE']);
    expect(r.actions[0]).toMatchObject({ adId: 'A' }); // B sold through Spotify: kept
  });

  it('never swaps an ad younger than 7 days', () => {
    const a = product({ productId: 'a', name: 'Item A', orders30d: 1 });
    const drop = product({ productId: 'd', name: 'Item D', priceUgx: 100_000, priorLowestUgx30d: 150_000 });
    const r = plan([a, drop], [ad({ adId: 'A', productId: 'a', tagline: taglineFor(a, 'BEST_SELLER'), startedAt: daysAgo(3) })], {}, 1);
    expect(r.actions).toEqual([]);
  });

  it('says why a qualifying product was skipped', () => {
    const r = plan([product({ firstPublishedAt: daysAgo(2), imageUrl: null })]);
    expect(r.skipped[0].why).toMatch(/first published .* but the product has no usable photo/);
  });
});
