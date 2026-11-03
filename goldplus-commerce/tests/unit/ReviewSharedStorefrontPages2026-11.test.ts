import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kampalaCutoff, computeNbaCandidates } from '../../packages/shared/src/nav/nba';
import { validateNavConfig, isRealHref, balancedTags } from '../../packages/shared/src/nav/validation';
import { DEFAULT_NAV_CONFIG } from '../../packages/shared/src/nav/config';
import { emBalanced, validateHeroSlide } from '../../packages/shared/src/hero/validation';
import { parseCsv, parseCsvRows } from '../../packages/shared/src/csv';
import { normalizeUgandanPhone } from '../../packages/shared/src/phone/uganda';
import { clipText } from '../../apps/web/src/lib/clipText';

const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');

// Saturday 18:00 EAT = 15:00 UTC.
const SAT_EVENING = new Date('2026-10-31T15:00:00Z');
const TUE_EVENING = new Date('2026-11-03T15:00:00Z');

const baseCtx = {
  signedIn: false, visits: 3, cart: 2, points: 0, lastOrderDays: null, orderInTransit: false,
  minsToCutoff: 0, saleLive: false, cutoffLabel: '5:00pm', deliverTo: null,
} as const;

describe('"tomorrow morning" respects closed days', () => {
  it('kampalaCutoff knows Sunday follows Saturday (default closed Sunday)', () => {
    expect(kampalaCutoff(SAT_EVENING).tomorrowClosed).toBe(true);
    expect(kampalaCutoff(TUE_EVENING).tomorrowClosed).toBe(false);
    expect(kampalaCutoff(TUE_EVENING, { closedDays: [3] }).tomorrowClosed).toBe(true);
  });
  it('Saturday after cutoff: cart and after-cutoff lines say next working day', () => {
    const cut = kampalaCutoff(SAT_EVENING);
    const c = computeNbaCandidates({ ...baseCtx, beforeCutoff: cut.beforeCutoff, sunday: cut.sunday, tomorrowClosed: cut.tomorrowClosed } as never);
    const text = c.map((x) => x.text).join(' | ');
    expect(text).not.toContain('tomorrow');
    expect(c.find((x) => x.id === 'cart-later')!.text).toContain('next working day');
    expect(c.find((x) => x.id === 'aftercutoff')!.text).toContain('next working day');
  });
  it('a weekday evening still says tomorrow morning', () => {
    const cut = kampalaCutoff(TUE_EVENING);
    const c = computeNbaCandidates({ ...baseCtx, beforeCutoff: cut.beforeCutoff, sunday: cut.sunday, tomorrowClosed: cut.tomorrowClosed } as never);
    expect(c.find((x) => x.id === 'cart-later')!.text).toContain('tomorrow morning');
  });
  it('the header passes tomorrowClosed and its client fallback checks the next day too', () => {
    const nav = read('apps/web/src/components/GpNav.astro');
    expect(nav).toContain('tomorrowClosed: cut.tomorrowClosed');
    expect(nav).toContain('var isClosedTomorrow = closedDays.indexOf((day + 1) % 7) !== -1;');
    expect(nav).toContain("gpClosedDays(navEl).indexOf((d.getDay() + 1) % 7) !== -1");
  });
  it('kampalaCutoff uses the time/eat helpers, not a hand-written UTC+3 shift', () => {
    const src = read('packages/shared/src/nav/nba.ts');
    expect(src).toContain('toEatParts(now)');
    expect(src).not.toContain('3 * 60 * 60 * 1000');
  });
});

describe('nav validation', () => {
  it('checks tag balance on holdSubManyVisits and holdSubDefault', () => {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_NAV_CONFIG));
    cfg.popover.returning.holdSubDefault = 'Welcome <em>back';
    cfg.popover.returning.holdSubManyVisits = 'Hi <b>again';
    const paths = validateNavConfig(cfg).map((e) => e.path);
    expect(paths).toContain('popover.returning.holdSubDefault');
    expect(paths).toContain('popover.returning.holdSubManyVisits');
  });
  it('tags must close in order', () => {
    expect(balancedTags('a </em>b<em>')).toBe(false);
    expect(balancedTags('<em>a</em> <b>b</b>')).toBe(true);
  });
  it('isRealHref refuses protocol-relative links', () => {
    expect(isRealHref('//evil.example/x')).toBe(false);
    expect(isRealHref('/\\evil.example')).toBe(false);
    expect(isRealHref('/shop')).toBe(true);
    expect(isRealHref('https://shopgoldplus.com/x')).toBe(true);
  });
});

describe('hero validation', () => {
  it('emBalanced checks order, not only counts', () => {
    expect(emBalanced('Fast </em>charging<em>')).toBe(false);
    expect(emBalanced('Fast <em>charging</em>')).toBe(true);
  });
  it('ctaUrl refuses //host', () => {
    const fields = (u: string) => validateHeroSlide({ ctaUrl: u } as never).map((e) => e.field);
    expect(fields('//evil.example/x')).toContain('ctaUrl');
    expect(fields('/shop')).not.toContain('ctaUrl');
  });
});

describe('csv: no silent data loss on imports', () => {
  it('keeps # rows unless comments are asked for', () => {
    expect(parseCsv('addr,n\n#12 Burton St,1\n')).toEqual([{ addr: '#12 Burton St', n: '1' }]);
    expect(parseCsv('# provenance\naddr,n\nx,1\n', { comments: true })).toEqual([{ addr: 'x', n: '1' }]);
  });
  it('keeps a leading apostrophe unless the file is our own guarded export', () => {
    expect(parseCsvRows("k\n'-5\n")).toEqual([['k'], ["'-5"]]);
    expect(parseCsvRows("k\n'-5\n", { unguardFormulas: true })).toEqual([['k'], ['-5']]);
  });
  it('only the repo data importers and the corridor round trip opt in', () => {
    expect(read('apps/api/src/application/use-cases/delivery/DeliveryCorridorCsvUseCase.ts')).toContain('parseCsvRows(csv, { unguardFormulas: true })');
    expect(read('apps/api/src/scripts/geo-apply-manual-points.ts')).toContain('{ comments: true }');
  });
});

describe('phone-battery alias redirect keeps the query', () => {
  it('uses carryQuery', () => {
    const src = read('apps/web/src/pages/phone-batteries/[device].astro');
    expect(src).toContain('carryQuery(phoneBatteryPath(deviceRes.data.device.slug), Astro.url.search), 301');
    expect(src).toContain('cutoffPhrase(biz.sameDayCutoffHour)');
  });
});

describe('shop personal order', () => {
  it('any personal order is private, and every page link carries lead', () => {
    const src = read('apps/web/src/pages/shop.astro');
    expect(src).toContain("if (preferredCategories.length > 0) Astro.response.headers.set('Cache-Control', 'private, no-store');");
    expect(src).toContain("if (preferredCategories.length > 0) params.set('lead', preferredCategories.join(','));");
  });
});

describe('clipText', () => {
  it('cuts hard when there is no space before the limit', () => {
    const out = clipText('X'.repeat(300), 160);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });
  it('cuts at a word boundary otherwise', () => {
    expect(clipText('alpha beta gamma', 12)).toBe('alpha beta…');
  });
});

describe('phone prefix warning', () => {
  it('the dead warning is gone; numbers still normalise', () => {
    expect(normalizeUgandanPhone('0772 123456')).toEqual({ e164: '+256772123456', warning: null });
    expect(read('packages/shared/src/phone/uganda.ts')).not.toContain('KNOWN_PREFIXES');
  });
});
