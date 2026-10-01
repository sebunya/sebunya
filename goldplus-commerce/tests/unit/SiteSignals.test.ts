import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hasSignedUpMarker, isMapLink, searchAlreadyCounted, searchTermOf, SIGNED_UP_COOKIE } from '../../apps/web/src/lib/siteSignalRules';
import { BrowserTelemetryEventSchema } from '../../packages/shared/src/events/telemetry';
import { cleanSelection, eventSelected } from '../../apps/api/src/domain/advertising/OptimisationEvents';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

describe('site signals: search, new account, shop directions', () => {
  it('a search is the shop page with a term; other pages and an empty term are not', () => {
    expect(searchTermOf('/shop', '?search=Power%20Bank')).toBe('power bank');
    expect(searchTermOf('/shop/', '?q=charger&page=2')).toBe('charger');
    expect(searchTermOf('/shop', '?category=power')).toBe('');
    expect(searchTermOf('/shop', '?search=%20')).toBe('');
    expect(searchTermOf('/products/x', '?search=charger')).toBe('');
  });
  it('paging, sorting or reloading the same results is not a second search; a new term is', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(searchAlreadyCounted('charger', s)).toBe(false);
    expect(searchAlreadyCounted('charger', s)).toBe(true);
    expect(searchAlreadyCounted('cable', s)).toBe(false);
    expect(searchAlreadyCounted('charger', null)).toBe(false);          // storage off: counted for this page view
  });
  it('the just-registered marker is exact; the register page sets it and it says nothing about the person', () => {
    expect(hasSignedUpMarker(`a=b; ${SIGNED_UP_COOKIE}=1; c=d`)).toBe(true);
    expect(hasSignedUpMarker(`${SIGNED_UP_COOKIE}=0`)).toBe(false);
    expect(hasSignedUpMarker(`x${SIGNED_UP_COOKIE}=1`)).toBe(false);
    const register = read('apps/web/src/pages/register.astro');
    expect(register).toMatch(/Astro\.cookies\.set\(SIGNED_UP_COOKIE, '1', \{[^}]*maxAge: 300/);
    // A first sign-in with Google or Apple is a new account too, and only then.
    expect(read('apps/web/src/pages/auth/[provider]/callback.ts')).toMatch(/if \(created === true\) headers\.append\('Set-Cookie', `\$\{SIGNED_UP_COOKIE\}=1;/);
  });
  it('a directions tap is a Google Maps link; any other link is not', () => {
    for (const ok of ['https://maps.app.goo.gl/abc', 'https://www.google.com/maps/place/x', 'https://goo.gl/maps/abc', 'https://maps.google.com/?q=1,2', 'https://www.google.co.ug/maps?q=x']) expect(isMapLink(ok)).toBe(true);
    for (const no of ['https://www.google.com/search?q=maps', 'https://wa.me/256700000000', 'http://maps.google.com/', '/locations/wilson-road', 'https://evilgoogle.com/maps']) expect(isMapLink(no)).toBe(false);
  });
  it('the collector accepts the three events from a browser, and they can be selected per destination', () => {
    for (const n of ['search', 'sign_up', 'find_location']) {
      expect(BrowserTelemetryEventSchema.safeParse({ event_name: n, event_id: '11111111-1111-4111-8111-111111111111', event_time: 1790000000, source: 'browser' }).success).toBe(true);
      expect(eventSelected(['view_item'], n)).toBe(false);
      expect(eventSelected(null, n)).toBe(true);
    }
    expect(cleanSelection(['search', 'sign_up', 'nonsense'], ['search', 'sign_up', 'find_location'])).toEqual(['search', 'sign_up']);
  });
  it('the signals run on every page, from the layout', () => {
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('recordSiteSignals();');
  });
});
