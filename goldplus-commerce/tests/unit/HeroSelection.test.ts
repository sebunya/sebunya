import { describe, it, expect } from 'vitest';
import {
  HERO_SLIDE_LIBRARY,
  HERO_SELECTION_TUNING,
  selectHeroSlides,
  type HeroSelectionContext,
} from '@goldplus/shared';

/**
 * Server-side hero selection (2026-08-07). Personalisation now runs on the
 * server for every visitor, so the choice of WHICH four slides show — and their
 * order — is a pure, testable function. These pin the behaviour the old inline
 * browser engine could never assert.
 */

const LIB = HERO_SLIDE_LIBRARY.filter((s) => s.enabled);
const show = HERO_SELECTION_TUNING.show; // 4

const base: HeroSelectionContext = {
  isNew: true, isReturning: false, isRegular: false, hasOrdered: false,
  saleLive: true, beforeCutoff: true, cartItems: 0, scratched: false, referred: false, serverCats: [],
};
const keys = (ctx: HeroSelectionContext) => selectHeroSlides(LIB, ctx).map((s) => s.slideKey);

describe('hero selection is deterministic and bounded', () => {
  it('returns exactly `show` slides for the full library', () => {
    expect(selectHeroSlides(LIB, base)).toHaveLength(show);
  });

  it('the same context always yields the same rail (safe to run on the server)', () => {
    expect(keys(base)).toEqual(keys({ ...base }));
  });

  it('never exceeds the per-theme cap (offer is capped at 2)', () => {
    const themes = selectHeroSlides(LIB, base).map((s) => s.theme);
    const offers = themes.filter((t) => t === 'offer').length;
    expect(offers).toBeLessThanOrEqual(HERO_SELECTION_TUNING.themeCap.offer);
  });

  it('orders the rail by funnel stage — the first slide has the lowest funnel weight', () => {
    const chosen = selectHeroSlides(LIB, base);
    const weights = chosen.map((s) => HERO_SELECTION_TUNING.funnel[s.theme] ?? 9);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });
});

describe('eligibility responds to real signals', () => {
  it('flash leads while its sale is live, and disappears once it has ended', () => {
    expect(keys({ ...base, saleLive: true })).toContain('flash');
    expect(keys({ ...base, saleLive: false })).not.toContain('flash');
  });

  it('a first-time non-customer sees the welcome promo; a customer never does', () => {
    expect(keys({ ...base, isNew: true, hasOrdered: false })).toContain('welcome');
    expect(keys({ ...base, isNew: true, hasOrdered: true })).not.toContain('welcome');
  });

  it('loyalty is shown to someone who has ordered, even on a fresh (isNew) device', () => {
    expect(keys({ ...base, isNew: true, hasOrdered: false })).not.toContain('loyalty');
    expect(keys({ ...base, isNew: true, hasOrdered: true })).toContain('loyalty');
  });

  it('a customer and a first-timer with the SAME local context get DIFFERENT rails', () => {
    const firstTimer = keys({ ...base, saleLive: false });
    const customer = keys({ ...base, saleLive: false, hasOrdered: true });
    expect(firstTimer).not.toEqual(customer);
  });

  it('real browsing affinity lifts new-arrivals into the rail', () => {
    // A returning visitor with no affinity vs one with strong affinity: affinity
    // must be able to pull new-arrivals in (its score gains +8 with serverCats).
    const withAffinity = keys({ ...base, isNew: false, isReturning: true, isRegular: true, saleLive: false, serverCats: ['phone-accessories'] });
    expect(withAffinity).toContain('newarrivals');
  });

  it('the scratch card is withheld once the visitor has already revealed a prize', () => {
    // A returning visitor with no live flash sale scores scratch (84) into the
    // rail; the `when` gate then removes it once the prize has been revealed.
    const returning: HeroSelectionContext = { ...base, isNew: false, isReturning: true, saleLive: false };
    expect(keys(returning)).toContain('scratch');
    expect(keys({ ...returning, scratched: true })).not.toContain('scratch');
  });

  it('always fills to `show` even when eligibility is restrictive', () => {
    // Everything that can be gated off, gated off: still a full, coherent rail.
    const restrictive: HeroSelectionContext = {
      ...base, saleLive: false, isNew: false, isReturning: false, isRegular: false,
      hasOrdered: false, scratched: true, beforeCutoff: false,
    };
    expect(selectHeroSlides(LIB, restrictive)).toHaveLength(show);
  });
});
