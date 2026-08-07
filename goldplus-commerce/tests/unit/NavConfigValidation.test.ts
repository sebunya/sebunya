import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NAV_CONFIG,
  validateNavConfig,
  sanitiseNavHtml,
  navVisibleText,
  NAV_LIMITS,
  HERO_SLIDE_LIBRARY,
  type NavConfig,
} from '@goldplus/shared';

/**
 * §9 guard rails. The header CMS must refuse any save that would break the
 * header — a broken header on every page is worse than a hardcoded one. These
 * pin the boundaries the editor relies on, plus the three seed-time corrections
 * baked into DEFAULT_NAV_CONFIG.
 */

const clone = (): NavConfig => structuredClone(DEFAULT_NAV_CONFIG);
// The sale deadline is time-relative; exclude it so this suite is deterministic
// regardless of when it runs (its own case below proves expiry is caught).
const structuralErrors = (cfg: NavConfig) =>
  validateNavConfig(cfg).filter((e) => e.path !== 'settings.saleEndsIso');

describe('DEFAULT_NAV_CONFIG', () => {
  it('validates clean (no structural errors)', () => {
    expect(structuralErrors(DEFAULT_NAV_CONFIG)).toEqual([]);
  });

  it('every mega-panel key has a matching rail entry', () => {
    const railKeys = new Set(DEFAULT_NAV_CONFIG.rail.map((r) => r.key));
    for (const p of DEFAULT_NAV_CONFIG.panels) expect(railKeys.has(p.key)).toBe(true);
  });

  it('mirrors the hero flash deadline — never a second, forkable clock', () => {
    const heroFlash = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === 'flash');
    expect(DEFAULT_NAV_CONFIG.settings.saleEndsIso).toBe(heroFlash?.extras?.saleEndsIso);
  });

  it('the first-order estimate is one field, and the refer link is not double-account', () => {
    expect(typeof DEFAULT_NAV_CONFIG.settings.firstOrderEstimateUgx).toBe('string');
    const refer = DEFAULT_NAV_CONFIG.popover.signedIn.links.find((l) => l.label === 'Refer a friend');
    expect(refer?.href).toBe('/account/rewards');
    expect(JSON.stringify(DEFAULT_NAV_CONFIG)).not.toContain('/account/account/');
  });
});

describe('validateNavConfig', () => {
  it('refuses a header with zero categories', () => {
    const c = clone(); c.rail = [];
    expect(validateNavConfig(c).some((e) => e.path === 'rail')).toBe(true);
  });

  it('refuses a category label past its width', () => {
    const c = clone(); c.rail[0].label = 'x'.repeat(NAV_LIMITS.categoryLabel + 1);
    expect(validateNavConfig(c).some((e) => e.path === 'rail[0].label')).toBe(true);
  });

  it('refuses a dead category link (# or empty)', () => {
    const c = clone(); c.rail[1].href = '#';
    expect(validateNavConfig(c).some((e) => e.path === 'rail[1].href')).toBe(true);
  });

  it('refuses a featured image with no alt text', () => {
    const c = clone();
    const power = c.panels.find((p) => p.key === 'power')!;
    power.featured!.alt = '   ';
    expect(validateNavConfig(c).some((e) => e.path === 'panels.power.featured.alt')).toBe(true);
  });

  it('refuses a featured name past its width', () => {
    const c = clone();
    const power = c.panels.find((p) => p.key === 'power')!;
    power.featured!.name = 'x'.repeat(NAV_LIMITS.featuredName + 1);
    expect(validateNavConfig(c).some((e) => e.path === 'panels.power.featured.name')).toBe(true);
  });

  it('refuses an unbalanced <b> tag in the zero-result copy', () => {
    const c = clone(); c.search.zeroResultCopy = 'No match for <b>{q}. Try again.';
    expect(validateNavConfig(c).some((e) => e.path === 'search.zeroResultCopy')).toBe(true);
  });

  it('refuses a flash-sale deadline that has already passed', () => {
    const c = clone(); c.settings.saleEndsIso = '2020-01-01T00:00:00+03:00';
    expect(validateNavConfig(c).some((e) => e.path === 'settings.saleEndsIso')).toBe(true);
  });
});

describe('sanitiseNavHtml (the XSS boundary)', () => {
  it('keeps the two allowed tags', () => {
    expect(sanitiseNavHtml('Up to <b>40% off</b> and <em>today only</em>')).toBe('Up to <b>40% off</b> and <em>today only</em>');
  });

  it('neutralises a script tag', () => {
    expect(sanitiseNavHtml('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('neutralises an event handler smuggled onto an allowed tag', () => {
    // <em onmouseover=...> is NOT the bare <em> the restore step allows, so it stays escaped.
    const out = sanitiseNavHtml('<em onmouseover="steal()">x</em>');
    expect(out).not.toContain('onmouseover="steal()"');
    expect(out).toContain('&lt;em onmouseover');
  });
});

describe('navVisibleText', () => {
  it('does not count the allowed tags toward the character width', () => {
    expect(navVisibleText('<b>40% off</b>')).toBe('40% off');
    expect(navVisibleText('<b>40% off</b>').length).toBeLessThan('<b>40% off</b>'.length);
  });
});
