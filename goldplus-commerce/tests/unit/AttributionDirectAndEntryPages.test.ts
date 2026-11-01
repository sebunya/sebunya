import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { creditOrder, journeyFor, MODEL_VERSION, type ObservedTouch } from '../../apps/api/src/domain/measurement/ChannelReport';
import { classifyChannel } from '../../apps/api/src/domain/measurement/Channels';
import { entryPagePath, entryPageSection, entryPagesReport, HUB_ROOTS } from '../../apps/api/src/domain/measurement/EntryPages';
import { ReclassifyTouchesUseCase } from '../../apps/api/src/application/use-cases/measurement/ChannelAttributionUseCases';
import type { ChannelAttributionStore, StoredTouch } from '../../apps/api/src/application/ports/measurement/ChannelAttribution';
import { landingTouch, loaderRules, untaggedArrivalHost } from '../../packages/shared/src/attribution/arrival';
import { CATEGORY_HUBS } from '../../apps/web/src/lib/categoryHubs';

/**
 * Attribution v2 (2026-10-29). The owner: "fix everything to do with attribution, it's not good enough."
 * What was wrong, each pinned here:
 *  - Last click gave a sale to the direct visit the customer paid on, burying the source that brought them.
 *  - Webmail and mail apps were filed as Google/Yahoo search; several assistants were missing.
 *  - Google's organic-result marker (srsltid) on a referrer-less visit read as Direct.
 *  - No first-party view of which pages start the journeys that end in sales.
 *  - Classifier fixes never reached past visits.
 */
const orderAt = new Date('2026-10-20T12:00:00Z');
const touch = (id: string, channel: string, daysBefore: number, detail = ''): ObservedTouch => ({ touchId: id, channel, detail, at: new Date(orderAt.getTime() - daysBefore * 86_400_000) });

describe('direct visits never take credit from a recorded source (channel-credit-v2)', () => {
  it('the model version moved, so every stored credit is recomputed under the new rule', () => {
    expect(MODEL_VERSION).toBe('channel-credit-v2');
  });
  it('found on Google, came back by typing the address to buy: Google keeps the sale under every model', () => {
    const credits = creditOrder({ orderAt, observed: [touch('a', 'organic_search', 3, 'www.google.com'), touch('b', 'direct', 0.1)], code: null, declared: null }, 40_000n);
    expect(new Set(credits.map((c) => c.channel))).toEqual(new Set(['organic_search']));
    expect(credits.every((c) => c.creditedUGX === 40_000n)).toBe(true);
  });
  it('a YouTube placement click followed by a direct return is the placement\'s sale (its scorecard reads last click)', () => {
    const credits = creditOrder({ orderAt, observed: [touch('a', 'youtube', 5, 'tech-review-oct'), touch('b', 'direct', 1)], code: null, declared: null }, 90_000n);
    expect(credits.filter((c) => c.model === 'last_click')).toMatchObject([{ channel: 'youtube', detail: 'tech-review-oct', weight: 1 }]);
  });
  it('a direct visit between two from the same source does not split them: they are one arrival', () => {
    const j = journeyFor({ orderAt, observed: [touch('a', 'organic_search', 9), touch('b', 'direct', 5), touch('c', 'organic_search', 2)], code: null, declared: null });
    expect(j.steps.map((s) => s.channel)).toEqual(['organic_search']);
  });
  it('a code on the order with only direct visits: the code is the whole journey', () => {
    const j = journeyFor({ orderAt, observed: [touch('a', 'direct', 2)], code: { kind: 'promo_code', detail: 'OCT10' }, declared: null });
    expect(j).toMatchObject({ basis: 'observed', steps: [{ channel: 'promo_code', detail: 'OCT10' }] });
  });
  it('only direct visits and an answer: the answer is the better evidence', () => {
    expect(journeyFor({ orderAt, observed: [touch('a', 'direct', 2)], code: null, declared: 'radio_tv' })).toEqual({ steps: [{ channel: 'offline_media', detail: '', at: orderAt }], basis: 'declared' });
  });
  it('only direct visits and no answer: Direct, honestly', () => {
    const j = journeyFor({ orderAt, observed: [touch('a', 'direct', 4), touch('b', 'direct', 1)], code: null, declared: null });
    expect(j).toMatchObject({ basis: 'observed', steps: [{ channel: 'direct' }] });
  });
  it('nothing at all is still no journey (No recorded source)', () => {
    expect(journeyFor({ orderAt, observed: [], code: null, declared: null })).toEqual({ steps: [], basis: null });
  });
});

describe('classifier: where a link was clicked', () => {
  it('a link in an email (webmail or a mail app) is email, not search', () => {
    for (const host of ['mail.google.com', 'com.google.android.gm', 'mail.yahoo.com', 'outlook.live.com', 'outlook.office.com', 'com.microsoft.office.outlook', 'mail.proton.me']) {
      expect(classifyChannel({ referrerHost: host }), host).toBe('email');
    }
  });
  it('search engines, including the Google app, are still search', () => {
    for (const host of ['www.google.com', 'www.google.co.ug', 'com.google.android.googlequicksearchbox', 'www.bing.com', 'duckduckgo.com', 'search.yahoo.com']) {
      expect(classifyChannel({ referrerHost: host }), host).toBe('organic_search');
    }
  });
  it('assistants and their apps are AI assistants', () => {
    for (const host of ['chatgpt.com', 'com.openai.chatgpt', 'www.perplexity.ai', 'ai.perplexity.app.android', 'grok.com', 'chat.mistral.ai', 'poe.com', 'copilot.cloud.microsoft', 'gemini.google.com']) {
      expect(classifyChannel({ referrerHost: host }), host).toBe('ai_assistant');
    }
    expect(classifyChannel({ source: 'grok.com', medium: 'referral' })).toBe('ai_assistant');
  });
});

describe('bought placements (radio, TV, podcasts, papers)', () => {
  it("a placement's link is its own channel, not Other (the scorecard reads offline_media arrivals)", () => {
    expect(classifyChannel({ source: 'radio', medium: 'placement', clickIdTypes: [] })).toBe('offline_media');
    expect(classifyChannel({ source: 'podcast', medium: 'placement' })).toBe('offline_media');
    expect(classifyChannel({ source: 'youtube', medium: 'sponsorship' })).toBe('youtube');
  });
  it('a placement code is matched by link slug to the placement published on or before the order day', () => {
    const store = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/measurement/DrizzleChannelAttributionStore.ts'), 'utf8');
    expect(store).toContain('mp.link_slug as placement_detail');
    expect(store).toMatch(/mp\.publish_date <= \(\$\{new Date\(o\.created_at\)\.toISOString\(\)\}::timestamptz at time zone 'Africa\/Kampala'\)::date/);
  });
});

describe("Google's organic-result marker (srsltid)", () => {
  const google = { search: '?srsltid=AfmBOoq123', referrer: '', ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', selfHost: 'shopgoldplus.com' };
  it('a referrer-less visit carrying it came from Google search', () => {
    const t = landingTouch(google);
    expect(t.referrerHost).toBe('google.com');
    expect(t.clickIdTypes).toEqual([]); // not a click id we keep, never sent to an ad platform
    expect(classifyChannel(t)).toBe('organic_search');
  });
  it('an ad click id or tags decide first', () => {
    expect(classifyChannel(landingTouch({ ...google, search: '?srsltid=x&gclid=abc' }))).toBe('paid_search');
    expect(untaggedArrivalHost(new URLSearchParams('srsltid=x&utm_source=newsletter&utm_medium=email'), google.ua)).toBeNull();
  });
  it('a real referrer is kept as it is', () => {
    expect(landingTouch({ ...google, referrer: 'https://www.google.com/' }).referrerHost).toBe('www.google.com');
  });
  it('the tag loader tells GA4 the same host (one rulebook)', () => {
    expect(loaderRules().soc).toMatchObject({ fbclid: 'facebook.com', srsltid: 'google.com' });
  });
});

describe('where sales started (first-party entry pages)', () => {
  it('one page per address: lower case, no trailing slash, the root kept', () => {
    expect(entryPagePath('/Phone-Batteries/tecno-spark-7-kf6n/')).toBe('/phone-batteries/tecno-spark-7-kf6n');
    expect(entryPagePath('/')).toBe('/');
    expect(entryPagePath('//')).toBe('/');
    expect(entryPagePath(null)).toBe('(unknown page)');
    expect(entryPagePath('not-a-path')).toBe('(unknown page)');
  });
  it('sections for the organic programme', () => {
    expect(entryPageSection('/phone-batteries/tecno-spark-7-kf6n')).toBe('Phone battery pages');
    expect(entryPageSection('/phone-batteries')).toBe('Category pages');
    expect(entryPageSection('/power/power-banks')).toBe('Category pages');
    expect(entryPageSection('/blog/tecno-battery-codes-bl-explained')).toBe('Guides');
    expect(entryPageSection('/products/bl-49ft-battery')).toBe('Product pages');
    expect(entryPageSection('/battery-finder')).toBe('Finders');
    expect(entryPageSection('/')).toBe('Home page');
    expect(entryPageSection('/r/abc123')).toBe('Invite links');
    expect(entryPageSection('/returns')).toBe('Other pages');
  });
  it('the hub list is the web\'s own (categoryHubs.ts)', () => {
    expect([...HUB_ROOTS].sort()).toEqual(CATEGORY_HUBS.map((h) => h.slug).sort());
  });
  it('groups sales by page and channel, biggest first, the rest summed so the table adds up', () => {
    const sales = [
      { orderId: 'o1', revenueUGX: 40_000n }, { orderId: 'o2', revenueUGX: 40_000n }, { orderId: 'o3', revenueUGX: 132_000n },
      { orderId: 'o4', revenueUGX: 18_000n }, { orderId: 'o5', revenueUGX: 50_000n },
    ];
    const entries = [
      { orderId: 'o1', landingPath: '/phone-batteries/tecno-spark-7-kf6n', channel: 'organic_search' },
      { orderId: 'o2', landingPath: '/phone-batteries/tecno-spark-7-kf6n/', channel: 'organic_search' },
      { orderId: 'o3', landingPath: '/products/ip-13-battery', channel: 'whatsapp' },
      { orderId: 'o4', landingPath: '/blog/swollen', channel: 'organic_search' },
      // o5 has no recorded visit (a code or an answer only)
    ];
    const r = entryPagesReport(sales, entries, 2);
    expect(r.sales).toBe(5);
    expect(r.salesWithVisit).toBe(4);
    expect(r.pages.map((p) => [p.path, p.channel, p.orders, p.revenueUGX])).toEqual([
      ['/products/ip-13-battery', 'whatsapp', 1, '132000'],
      ['/phone-batteries/tecno-spark-7-kf6n', 'organic_search', 2, '80000'],
    ]);
    expect(r.pages[1].channelLabel).toBe('Organic search');
    expect(r.otherPages).toEqual({ pages: 1, orders: 1, revenueUGX: '18000' });
    const sec = Object.fromEntries(r.sections.map((s) => [s.section, [s.orders, s.revenueUGX]]));
    expect(sec).toEqual({ 'Product pages': [1, '132000'], 'Phone battery pages': [2, '80000'], Guides: [1, '18000'] });
  });
});

describe('classifier fixes reach past visits (ReclassifyTouchesUseCase)', () => {
  function store(touches: StoredTouch[]) {
    const written: Array<{ touchId: string; channel: string }> = [];
    const s = {
      touchesSince: async (_since: Date, after: { occurredAt: Date; touchId: string } | null, limit: number) => {
        const from = after ? touches.findIndex((t) => t.touchId === after.touchId) + 1 : 0;
        return touches.slice(from, from + limit);
      },
      setTouchChannels: async (u: Array<{ touchId: string; channel: string }>) => { written.push(...u); return u.length; },
    } as unknown as ChannelAttributionStore;
    return { s, written };
  }
  const at = new Date('2026-10-01T00:00:00Z');
  const t = (id: string, channel: string, referrerHost: string | null, source: string | null = null, medium: string | null = null): StoredTouch =>
    ({ touchId: id, occurredAt: at, channel, source, medium, referrerHost, clickIdTypes: [] });
  const touches = [
    t('1', 'organic_search', 'mail.google.com'),           // was search, is email
    t('2', 'organic_search', 'www.google.com'),             // unchanged
    t('3', 'referral', 'outlook.live.com'),                 // was referral, is email
    t('4', 'referral', 'grok.com'),                         // was referral, is AI
    t('5', 'whatsapp', null, 'whatsapp', 'chat'),           // unchanged (tagged)
  ];
  it('a dry run reports old → new and writes nothing', async () => {
    const { s, written } = store(touches);
    const r = await new ReclassifyTouchesUseCase(s, () => at).execute({ days: 30, dryRun: true });
    expect(r).toMatchObject({ scanned: 5, changed: 3, written: 0, capped: false });
    expect(r.changes).toEqual({ 'organic_search → email': 1, 'referral → email': 1, 'referral → ai_assistant': 1 });
    expect(written).toEqual([]);
  });
  it('a live run rewrites only what changed, across pages (page size 2: three pages)', async () => {
    const { s, written } = store(touches);
    const r = await new ReclassifyTouchesUseCase(s, () => at, 2).execute({ days: 30, dryRun: false });
    expect(r).toMatchObject({ scanned: 5, changed: 3, written: 3, capped: false });
    expect(written.map((w) => `${w.touchId}:${w.channel}`).sort()).toEqual(['1:email', '3:email', '4:ai_assistant']);
  });
});
