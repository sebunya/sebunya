import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeNbaCandidates, DEFAULT_NAV_CONFIG, type NbaContext } from '@goldplus/shared';
import {
  NavAvailabilityService,
  navHrefQuery,
  resolveCategory,
} from '../../apps/api/src/application/nav/NavAvailabilityService';

/**
 * The header shipped a battery finder — a model search and eleven brand chips —
 * over a catalogue carrying zero batteries. Every chip landed on "no results".
 *
 * Nothing was fabricated (unlike the scarcity in NoInventedScarcityInHeader);
 * the category was simply unstocked. But advertising eleven dead ends is still
 * a promise the shop cannot keep, so the finder must prove each link lands on
 * stock before it renders, and disappear entirely when none do.
 */

const ROOT = join(__dirname, '../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const NAV = code('apps/web/src/components/GpNav.astro');

/**
 * A counter standing in for the catalogue. It insists on the CANONICAL category
 * slug, exactly as the real repository does: production stores `power-devices`
 * and treats `power` only as an alias, so a counter that accepted the raw param
 * would hide the very bug this guards.
 */
const CANONICAL = 'power-devices';
const counterFor = (stocked: Record<string, number>) => ({
  execute: async (o: { search?: string; category?: string }) =>
    o.category && o.category !== CANONICAL
      ? []
      : Array.from({ length: stocked[o.search ?? ''] ?? 0 }, (_, i) => ({ id: i })),
});

/** The shape production actually serves: canonical slug, `power` as an alias. */
const TAXONOMY = [
  { slug: CANONICAL, name: 'Power Devices', aliases: ['power'], subcategories: [] },
] as any;
const taxonomyProvider = { getPublicConfig: async () => TAXONOMY };

describe('navHrefQuery — the count runs the link\'s own query', () => {
  it('recovers the category and search a chip href encodes', () => {
    expect(navHrefQuery('/shop?category=power&q=tecno')).toEqual({
      category: 'power',
      search: 'tecno',
    });
  });

  it('treats a link with nothing to search as uncountable, not as a match', () => {
    expect(navHrefQuery('#')).toBeNull();
    expect(navHrefQuery('')).toBeNull();
    expect(navHrefQuery('/shop')).toBeNull();
  });
});

describe('resolveCategory — the count resolves what the customer\'s URL resolves to', () => {
  it('maps the nav\'s alias onto the slug the catalogue stores', () => {
    // `/shop?category=power` reaches `power-devices` via the taxonomy alias.
    // Counting the raw `power` returned 0 for every Power link and would have
    // hidden the finder even with batteries in stock.
    expect(resolveCategory('power', TAXONOMY)).toBe(CANONICAL);
  });

  it('leaves a canonical slug alone, and is case-insensitive', () => {
    expect(resolveCategory(CANONICAL, TAXONOMY)).toBe(CANONICAL);
    expect(resolveCategory('POWER', TAXONOMY)).toBe(CANONICAL);
  });

  it('never turns an unknown category into "no filter"', () => {
    // Dropping it would count the entire shop and claim stock the link cannot show.
    expect(resolveCategory('nonsense', TAXONOMY)).toBe('nonsense');
    expect(resolveCategory(undefined, TAXONOMY)).toBeUndefined();
  });
});

describe('NavAvailabilityService', () => {
  it('counts every chip against the catalogue, keyed by its own href', async () => {
    const svc = new NavAvailabilityService(counterFor({ tecno: 3, battery: 3 }), taxonomyProvider);
    const out = await svc.forBatteryFinder(DEFAULT_NAV_CONFIG);

    expect(out.counts['/shop?category=power&q=tecno']).toBe(3);
    expect(out.counts['/shop?category=power&q=samsung']).toBe(0);
    expect(out.finderTotal).toBe(3);
  });

  it('reports the live catalogue — today that is nothing at all', async () => {
    const svc = new NavAvailabilityService(counterFor({}), taxonomyProvider);
    const out = await svc.forBatteryFinder(DEFAULT_NAV_CONFIG);

    expect(out.finderTotal).toBe(0);
    expect(Object.values(out.counts).every((n) => n === 0)).toBe(true);
  });

  it('fails CLOSED when the catalogue throws — an outage is not stock', async () => {
    const svc = new NavAvailabilityService(
      { execute: async () => { throw new Error('db down'); } },
      taxonomyProvider,
    );
    const out = await svc.forBatteryFinder(DEFAULT_NAV_CONFIG);

    expect(out.finderTotal).toBe(0);
    expect(Object.values(out.counts).every((n) => n === 0)).toBe(true);
  });

  it('fails CLOSED when the TAXONOMY is unavailable, rather than counting raw', async () => {
    const svc = new NavAvailabilityService(counterFor({ battery: 5 }), {
      getPublicConfig: async () => { throw new Error('taxonomy down'); },
    });
    const out = await svc.forBatteryFinder(DEFAULT_NAV_CONFIG);

    expect(out.finderTotal).toBe(0);
  });
});

describe('the header gates the finder on those counts', () => {
  it('renders chips from the counted list, never the hard-coded eleven', () => {
    expect(NAV).toContain('batteryChips.map');
    // The brand literals the chips used to be. If these come back, the gate is
    // bypassed no matter what batteryChips says.
    for (const brand of ['q=tecno', 'q=infinix', 'q=samsung', 'q=iphone', 'q=oppo']) {
      expect(NAV).not.toContain(brand);
    }
  });

  it('keeps only chips that land on stock', () => {
    expect(NAV).toMatch(/batteryChips = \(batteryFinder\?\.brandChips \?\? \[\]\)\.filter\(\(c\) => hasStock\(navAvail, c\.href\)\)/);
  });

  it('requires both a stocked finder AND at least one live chip', () => {
    expect(NAV).toMatch(/batteryLive = navAvail\.finderTotal > 0 && batteryChips\.length > 0/);
  });

  it('gates the desktop panel and the mobile accordion alike', () => {
    expect(NAV.match(/\{batteryLive && batteryFinder && \(/g) ?? []).toHaveLength(2);
  });

  it('gates the client-built reorder nudge too', () => {
    // It is assembled in the browser, so a server-side sweep alone misses it.
    expect(NAV).toMatch(/CFG\.batteryLive && CTX\.signedIn/);
    expect(NAV).toMatch(/^\s*batteryLive,$/m);
  });
});

describe('the reorder nudge never outlives the stock behind it', () => {
  const base: NbaContext = {
    signedIn: true, visits: 4, cart: 0, points: 0, lastOrderDays: 400,
    orderInTransit: false, beforeCutoff: true, minsToCutoff: 120, sunday: false,
  } as NbaContext;

  it('is withheld when no batteries are stocked', () => {
    const ids = computeNbaCandidates(base).map((i) => i.id);
    expect(ids).not.toContain('reorder');
  });

  it('is withheld when the field is simply absent — the default is NO', () => {
    const { batteriesInStock, ...withoutField } = { ...base, batteriesInStock: true };
    expect(computeNbaCandidates(withoutField as NbaContext).map((i) => i.id)).not.toContain('reorder');
  });

  it('returns by itself once batteries are stocked — no redeploy', () => {
    const ids = computeNbaCandidates({ ...base, batteriesInStock: true }).map((i) => i.id);
    expect(ids).toContain('reorder');
  });
});
