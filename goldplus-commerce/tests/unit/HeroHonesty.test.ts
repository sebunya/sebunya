import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HERO_SLIDE_LIBRARY } from '@goldplus/shared';
import { HeroContentService, heroTierMeter } from '../../apps/api/src/application/hero/HeroContentService';

/**
 * Hero honesty sweep (2026-09-24).
 *  - The seed promised member pricing, warranties in one place, next-day
 *    delivery everywhere and "new this month" — none of it true.
 *  - The same-day pill counted down to the slide row's cutoff on the device's
 *    clock, while the headline used business_info's; Sunday was hardcoded.
 *  - Referral and loyalty slides promised points while the programme was off.
 *  - The loyalty bar always filled to 68%.
 */

const ROOT = join(__dirname, '../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const slide = (key: string) => HERO_SLIDE_LIBRARY.find((s) => s.slideKey === key)!;
const text = (key: string) => {
  const s = slide(key);
  return `${s.kicker} ${s.headline} ${s.subcopy} ${s.finePrint}`;
};

describe('the hero seed states only what is true', () => {
  it('no member pricing and no warranty wallet on the loyalty slide', () => {
    expect(text('loyalty')).not.toMatch(/member pric|warrant/i);
  });

  it('no next-day promise for upcountry, and the cutoff is a token, never a typed hour', () => {
    expect(text('sameday')).not.toMatch(/next day everywhere/i);
    expect(slide('sameday').finePrint).toContain('{cutoff}');
    expect(slide('sameday').finePrint).not.toMatch(/\d\s*:\s*\d\d|Monday to Saturday/i);
  });

  it('no unchecked freshness claims on new arrivals', () => {
    expect(text('newarrivals')).not.toMatch(/this month|restocked weekly/i);
  });

  it('the data migration rewrites only rows still carrying the old seed text', () => {
    const sql = readFileSync(join(ROOT, 'apps/api/src/infrastructure/db/migrations/0150_hero_copy_honesty.sql'), 'utf8');
    const updates = sql.split('--> statement-breakpoint');
    expect(updates).toHaveLength(5);
    for (const u of updates) expect(u).toMatch(/WHERE "slide_key" = '[a-z]+'\s+AND "[a-z_]+" = '/);
    // Old code (migrate runs before the roll) renders fine print as-is, so the
    // migration must never write a token only new code fills.
    expect(sql).not.toMatch(/SET "[a-z_]+" = '[^']*\{cutoff\}/);
    expect(sql).toContain(`SET "fine_print" = 'Order before the cut-off on days the shop is open'`);
    const journal = readFileSync(join(ROOT, 'apps/api/src/infrastructure/db/migrations/meta/_journal.json'), 'utf8');
    expect(journal).toContain('"0150_hero_copy_honesty"');
  });
});

describe('the same-day cutoff has one authority (business_info)', () => {
  const stored = HERO_SLIDE_LIBRARY.filter((s) => s.enabled).map((s) => ({ ...s, id: s.slideKey, updatedAt: new Date() }));
  const repo: any = {
    listEnabled: async () => stored,
    getSettings: async () => ({ slidesShown: 4, dwellMs: 6000, autoplay: true }),
  };
  const signals = { visits: 1, hasOrdered: false, categoryAffinity: [], preferredProduct: null, loyalty: null, stockBySlug: {} };
  const noSale = async () => ({ active: false as const });

  it("config.cutoffHour is the operator's hour, not the slide row's 17", async () => {
    const svc = new HeroContentService(repo, noSale, async () => ({ cutoffHour: 15, closedDays: [0] }));
    expect((await svc.getPublicPayload()).config.cutoffHour).toBe(15);
  });

  it('a failed business_info read falls back to the slide value', async () => {
    const svc = new HeroContentService(repo, noSale, async () => { throw new Error('db down'); });
    expect((await svc.getPublicPayload()).config.cutoffHour).toBe(17);
  });

  it("selection honours the operator's closed days, not a hardcoded Sunday", async () => {
    // 2026-09-27 is a Sunday; 10:00 Kampala = 07:00Z.
    const sunday = new Date('2026-09-27T07:00:00Z');
    const openSunday = new HeroContentService(repo, noSale, async () => ({ cutoffHour: 17, closedDays: [] }));
    const closedSunday = new HeroContentService(repo, noSale, async () => ({ cutoffHour: 17, closedDays: [0] }));
    // `aftercutoff` is the QA switch; without it, an open Sunday before the
    // cutoff must score the same-day slide as live (it leads the logistics slot).
    const open = await openSunday.buildPersonalisedPayload(signals, { cartItems: 0, referred: false, now: sunday });
    const closed = await closedSunday.buildPersonalisedPayload(signals, { cartItems: 0, referred: false, now: sunday });
    const logistics = (p: { slides: Array<{ slideKey: string; theme: string }> }) => p.slides.find((s) => s.theme === 'logistics')?.slideKey;
    expect(logistics(open)).toBe('sameday');
    expect(logistics(closed)).toBe('fees');
  });

  it('the pill counts down on the Kampala clock to the business_info hour and names no fixed closed day', () => {
    const slider = code('apps/web/src/components/hero/HeroSlider.astro');
    expect(slider).not.toMatch(/CMS\.cutoffHour/);
    expect(slider).toMatch(/cutoffHour: heroShopCutoffHour\(\)/);
    expect(slider).toMatch(/var end = new Date\(now\)/);
    expect(slider).not.toMatch(/Closed Sunday/);
    expect(slider).toMatch(/fillHeroTokens\(s\.subcopy\)/);
    expect(slider).toMatch(/fillHeroTokens\(s\.finePrint\)/);
  });
});

describe('points slides only run while the programme can honour them', () => {
  const stored = HERO_SLIDE_LIBRARY.filter((s) => s.enabled).map((s) => ({ ...s, id: s.slideKey, updatedAt: new Date() }));
  const repo: any = {
    listEnabled: async () => stored,
    getSettings: async () => ({ slidesShown: 12, dwellMs: 6000, autoplay: true }),
  };
  const customer = { visits: 6, hasOrdered: true, categoryAffinity: [], preferredProduct: null, loyalty: null, stockBySlug: {} };
  const keys = async (programme?: () => Promise<{ loyaltyActive: boolean; referralEarns: boolean }>) =>
    (await new HeroContentService(repo, async () => ({ active: false }), undefined, programme)
      .buildPersonalisedPayload(customer, { cartItems: 0, referred: false, now: new Date('2026-09-24T07:00:00Z') }))
      .slides.map((s) => s.slideKey);

  it('withholds loyalty and referral when the programme is off', async () => {
    const k = await keys(async () => ({ loyaltyActive: false, referralEarns: false }));
    expect(k).not.toContain('loyalty');
    expect(k).not.toContain('referral');
  });

  it('keeps them when the programme runs with referral points', async () => {
    const k = await keys(async () => ({ loyaltyActive: true, referralEarns: true }));
    expect(k).toContain('loyalty');
    expect(k).toContain('referral');
  });

  it('a failed programme read changes nothing', async () => {
    expect(await keys(async () => { throw new Error('down'); })).toEqual(await keys());
  });
});

describe('the loyalty meter shows real progress or none', () => {
  const tiers = [
    { name: 'Bronze', threshold: 0 },
    { name: 'Silver', threshold: 2500 },
    { name: 'Gold', threshold: 10000 },
  ];

  it('no configured tiers = no goal and no bar', () => {
    expect(heroTierMeter(1234, [])).toEqual({ tierLabel: '', goalRemaining: 0, progress: null });
  });

  it('progress is the real share of the current step', () => {
    expect(heroTierMeter(1250, tiers)).toEqual({ tierLabel: 'Silver', goalRemaining: 1250, progress: 0.5 });
    expect(heroTierMeter(2500, tiers)).toEqual({ tierLabel: 'Gold', goalRemaining: 7500, progress: 0 });
    expect(heroTierMeter(9999, tiers).progress).toBeCloseTo(1, 1);
  });

  it('the top tier is full', () => {
    expect(heroTierMeter(20000, tiers)).toEqual({ tierLabel: 'Gold', goalRemaining: 0, progress: 1 });
  });

  it('the slider has no fixed fill and needs a real balance to draw the meter', () => {
    const slider = code('apps/web/src/components/hero/HeroSlider.astro');
    expect(slider).not.toMatch(/scaleX\(\.68\)/);
    expect(slider).toMatch(/typeof ex\.points === 'number'/);
    expect(slider).toMatch(/--gph-progress/);
  });
});
