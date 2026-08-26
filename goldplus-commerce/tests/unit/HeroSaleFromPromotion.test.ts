import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HERO_SLIDE_LIBRARY, DEFAULT_NAV_CONFIG, computeNbaCandidates, DEFAULT_NBA_RATES } from '@goldplus/shared';
import { HeroContentService } from '../../apps/api/src/application/hero/HeroContentService';

/**
 * The homepage hero advertised "Up to 40% off power banks — UGX 185,000 →
 * UGX 111,000" from figures typed into the slide row, against a deadline
 * (2026-08-09) that had passed while a real 10% promotion ran unadvertised.
 * Two hero buttons pointed at pages that 404. The header popover promised
 * "10% off your first order — still reserved" from a CMS number with no
 * pricing rule behind it. CLAUDE.md: no invented product facts, no fake
 * urgency. Every sale claim now comes from the one live promotion.
 */

const ROOT = join(__dirname, '../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Does a storefront route exist for this path? Query strings are ignored. */
function pageExists(href: string): boolean {
  const path = href.split('?')[0].replace(/\/$/, '') || '/';
  if (path === '/') return true;
  const base = join(ROOT, 'apps/web/src/pages', path);
  return existsSync(`${base}.astro`) || existsSync(join(base, 'index.astro'));
}

describe('hero slides carry no typed sale figures', () => {
  const flash = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === 'flash')!;

  it('the flash slide has no deadline and no prices of its own', () => {
    expect(flash.extras?.saleEndsIso).toBeUndefined();
    expect(flash.extras?.originalPriceUgx).toBeUndefined();
    expect(flash.extras?.salePriceUgx).toBeUndefined();
    expect(flash.extras?.savePct).toBeUndefined();
    expect(`${flash.kicker} ${flash.headline} ${flash.subcopy}`).not.toMatch(/\d+\s*%/);
  });

  it('no slide promises a code, a first-order discount, or points that never expire', () => {
    for (const s of HERO_SLIDE_LIBRARY.filter((s) => s.enabled)) {
      const text = `${s.kicker} ${s.headline} ${s.subcopy} ${s.finePrint} ${s.ctaUrl}`;
      expect(text, s.slideKey).not.toMatch(/never expire|promo=|first order only|WELCOME10/i);
      expect(s.extras?.promoCode, s.slideKey).toBeUndefined();
      expect(s.extras?.points, s.slideKey).toBeUndefined();
    }
  });

  it('every enabled slide links to a page that exists', () => {
    // /support/delivery and /account/referrals both returned 404 from the homepage.
    for (const s of HERO_SLIDE_LIBRARY.filter((s) => s.enabled && s.ctaUrl)) {
      expect(pageExists(s.ctaUrl), `${s.slideKey} → ${s.ctaUrl}`).toBe(true);
    }
  });

  it('the slider renders the sale figure from config, not from the slide row', () => {
    const slider = code('apps/web/src/components/hero/HeroSlider.astro');
    expect(slider).toMatch(/config\.flashPercent/);
    expect(slider).not.toMatch(/ex\.originalPriceUgx|ex\.savePct|ex\.salePriceUgx/);
  });
});

describe('HeroContentService derives the sale from the live promotion', () => {
  const repo: any = {
    listEnabled: async () => HERO_SLIDE_LIBRARY.filter((s) => s.enabled).map((s) => ({ ...s, id: s.slideKey, updatedAt: new Date() })),
    getSettings: async () => ({ slidesShown: 5, dwellMs: 6000, autoplay: true }),
  };

  it('reports the promotion deadline and percentage when one runs', async () => {
    const svc = new HeroContentService(repo, async () => ({ active: true, percent: 10, endsIso: '2999-01-01T00:00:00.000Z' }));
    const { config } = await svc.getPublicPayload();
    expect(config.flashSaleEnds).toBe('2999-01-01T00:00:00.000Z');
    expect(config.flashPercent).toBe(10);
  });

  it('reports no sale when none runs, and when the pricing source throws', async () => {
    const none = await new HeroContentService(repo, async () => ({ active: false })).getPublicPayload();
    expect(none.config.flashSaleEnds).toBeNull();
    expect(none.config.flashPercent).toBeNull();
    const broken = await new HeroContentService(repo, async () => { throw new Error('pricing down'); }).getPublicPayload();
    expect(broken.config.flashSaleEnds).toBeNull();
  });
});

describe('the header popover names only the live sale', () => {
  const nav = code('apps/web/src/components/GpNav.astro');

  it('has no "first order" offer, no "reserved" tag, no visit counting, no typed percentage', () => {
    expect(nav).not.toMatch(/your first order/i);
    expect(nav).not.toMatch(/Still reserved|Reserved for you/);
    expect(nav).not.toMatch(/This is visit/);
    expect(nav).not.toMatch(/up to <b>\d+% off/i);
    expect(nav).not.toMatch(/EST_FIRST|RATE_FIRST/);
  });

  it('gates the sale block and the sale nudge on the live promotion', () => {
    expect(nav).toMatch(/saleActive: navDeal\.active/);
    expect(nav).toMatch(/var SALE_ON = CFG\.saleActive === true/);
    expect(nav).toMatch(/CTX\.saleLive && RATE_SALE > 0/);
  });

  it('the seed popover copy carries no first-order promise either', () => {
    const seed = JSON.stringify(DEFAULT_NAV_CONFIG.popover);
    expect(seed).not.toMatch(/first order|reserved/i);
    expect(DEFAULT_NAV_CONFIG.settings.saleEndsIso).toBe('');
  });

  it('the shared NBA never claims a discount without a live percentage', () => {
    const base: any = { signedIn: false, visits: 1, cart: 0, points: 0, lastOrderDays: null, orderInTransit: false, beforeCutoff: true, minsToCutoff: 100, sunday: false, saleLive: true };
    const noPct = computeNbaCandidates(base, { ...DEFAULT_NBA_RATES, salePct: 0 });
    expect(JSON.stringify(noPct)).not.toMatch(/% off/);
  });
});

describe('the fees slide reads delivery fees from the quoting service', () => {
  it('the seed carries no typed fee amounts, only sample areas', () => {
    const fees = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === 'fees')!;
    expect(fees.extras?.fees).toBeUndefined();
    expect(JSON.stringify(fees)).not.toMatch(/UGX\s*[0-9]/);
    expect(Array.isArray(fees.extras?.sampleAreas)).toBe(true);
  });

  it('the slider asks the ONE quoting service and shows a figure only when it quotes one', () => {
    const slider = code('apps/web/src/components/hero/HeroSlider.astro');
    expect(slider).toMatch(/\/delivery\/quote/);
    expect(slider).toMatch(/d\.tone === 'quoted' && typeof d\.feeUgx === 'number'/);
    expect(slider).toMatch(/ex\.fees\.length > 0/);
  });
});
