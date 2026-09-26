import { describe, expect, it } from 'vitest';
import { HERO_SLIDE_LIBRARY } from '@goldplus/shared';
import { HeroContentService, categoryShortName } from '../../apps/api/src/application/hero/HeroContentService';

/**
 * The engine lands a shopper with a category affinity in THAT category
 * ("See what's new" → /shop?category=sound-devices). The slide copy promises
 * the whole range, so the button must say where it goes.
 */
const stored = HERO_SLIDE_LIBRARY.filter((s) => s.enabled).map((s) => ({ ...s, id: s.slideKey, updatedAt: new Date() }));
const repo: any = { listEnabled: async () => stored, getSettings: async () => ({ slidesShown: 12, dwellMs: 6000, autoplay: true }) };
const noSale = async () => ({ active: false as const });
const svc = new HeroContentService(repo, noSale, async () => ({ cutoffHour: 17, closedDays: [] }));
const signals = (categorySlug: string | null) => ({
  visits: 3, hasOrdered: false, preferredProduct: null, loyalty: null, stockBySlug: {},
  categoryAffinity: categorySlug ? [{ categorySlug, score: 5 }] : [],
});
const input = { cartItems: 0, referred: false, now: new Date('2026-09-26T09:00:00+03:00'), force: 'returning' };

describe('hero CTA follows the personalised landing', () => {
  it('names the category when the landing is one category', async () => {
    const p = await svc.buildPersonalisedPayload(signals('sound-devices') as any, input);
    const s = p.slides.find((x) => x.slideKey === 'newarrivals');
    expect(s?.ctaUrl).toBe('/shop?category=sound-devices');
    expect(s?.ctaLabel).toBe("See what's new in Sound");
    const r = p.slides.find((x) => x.slideKey === 'range');
    if (r) expect(r.ctaLabel).toBe('Browse everything in Sound');
  });

  it('keeps the authored label and /shop without an affinity', async () => {
    const p = await svc.buildPersonalisedPayload(signals(null) as any, input);
    const s = p.slides.find((x) => x.slideKey === 'newarrivals');
    expect(s?.ctaUrl).toBe('/shop');
    expect(s?.ctaLabel).toBe("See what's new");
  });

  it('an unknown slug keeps the authored label (never invents a category name)', async () => {
    const p = await svc.buildPersonalisedPayload(signals('mystery') as any, input);
    const s = p.slides.find((x) => x.slideKey === 'newarrivals');
    expect(s?.ctaUrl).toBe('/shop?category=mystery');
    expect(s?.ctaLabel).toBe("See what's new");
  });

  it('short names drop the taxonomy suffix', () => {
    expect(categoryShortName('sound-devices')).toBe('Sound');
    expect(categoryShortName('car-accessories')).toBe('Car');
    expect(categoryShortName('nope')).toBeNull();
  });
});
