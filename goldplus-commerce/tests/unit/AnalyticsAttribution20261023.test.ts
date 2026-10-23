import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { smsSegments, tagShopLinks, tagShopLinksInSms, tagShopUrl } from '../../packages/shared/src/links/shopLinkTag';
import { carryQuery } from '../../apps/web/src/lib/carryQuery';
import { formatWhatsAppReply } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';
import { formatSocialReply } from '../../apps/api/src/domain/assistant/SocialGoldie';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/**
 * GA4 audit, 2026-10-23: 94.6% of users "Direct", 562 of 1,306 neither new nor returning. The causes and their fixes,
 * one block each.
 */
describe('our own links say where they were tapped', () => {
  it('an SMS link gets ch=s.<campaign>; sentence punctuation stays outside; a #code stays last', () => {
    expect(tagShopLinks('Track it: https://shopgoldplus.com/track-order?reference=GP-1.', 's'))
      .toBe('Track it: https://shopgoldplus.com/track-order?reference=GP-1&ch=s.track.');
    expect(tagShopUrl('https://www.shopgoldplus.com/gift-card/open#GPGC-AB12', 's'))
      .toBe('https://www.shopgoldplus.com/gift-card/open?ch=s.gift#GPGC-AB12');
    expect(tagShopUrl('https://shopgoldplus.com', 'e')).toBe('https://shopgoldplus.com/?ch=e.link');
  });

  it('leaves alone: admin links, a link that already says where it came from, other sites', () => {
    expect(tagShopUrl('https://shopgoldplus.com/admin/orders/1', 'e')).toBe('https://shopgoldplus.com/admin/orders/1');
    expect(tagShopUrl('https://shopgoldplus.com/invite?utm_source=customer_invite', 'w')).toBe('https://shopgoldplus.com/invite?utm_source=customer_invite');
    expect(tagShopUrl('https://shopgoldplus.com/shop?ch=s.shop', 'w')).toBe('https://shopgoldplus.com/shop?ch=s.shop');
    expect(tagShopLinks('see https://example.com/x', 'e')).toBe('see https://example.com/x');
  });

  it('inside email HTML the existing query (and its &amp;) is kept as written', () => {
    expect(tagShopLinks('<a href="https://shopgoldplus.com/track-order?reference=GP-1&amp;x=1">Track</a>', 'e'))
      .toBe('<a href="https://shopgoldplus.com/track-order?reference=GP-1&amp;x=1&ch=e.track">Track</a>');
  });

  it('an SMS is tagged only when it costs no extra part', () => {
    const link = 'https://shopgoldplus.com/track-order?reference=GP-10427';
    const near = `GoldPlus: on its way. ${'x'.repeat(155 - 23 - link.length)} ${link}`;
    expect(near.length).toBe(155);
    expect(smsSegments(near)).toBe(1);
    expect(tagShopLinksInSms(near)).toBe(near);
    const roomy = `GoldPlus: on its way: https://shopgoldplus.com/track-order?reference=GP-10427`;
    expect(tagShopLinksInSms(roomy)).toContain('&ch=s.track');
    expect(smsSegments('é'.repeat(70))).toBe(1);
    expect(smsSegments('€'.repeat(81))).toBe(2);
  });

  it('Goldie says WhatsApp / Messenger / Instagram, campaign goldie', () => {
    const r = { text: 'Here it is.', products: [], links: [{ label: 'Track', url: 'https://shopgoldplus.com/track-order?reference=GP-1' }] } as never;
    expect(formatWhatsAppReply(r)).toContain('https://shopgoldplus.com/track-order?reference=GP-1&ch=w.goldie');
    expect(formatSocialReply(r, 'messenger')).toContain('&ch=m.goldie');
    expect(formatSocialReply(r, 'instagram')).toContain('&ch=i.goldie');
  });

  it('every send point tags: SMS adapter, email adapter, WhatsApp text and template, staff copy, app start', () => {
    expect(read('apps/api/src/infrastructure/notifications/sms/PahappaCommsSmsAdapter.ts')).toMatch(/const text = tagShopLinksInSms\(/);
    expect(read('apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts')).toMatch(/htmlContent = tagShopLinks\(htmlContent, 'e'\)/);
    expect(read('apps/api/src/application/notifications/CustomerMessages.ts')).toMatch(/return tagShopLinks\(`\$\{greeting/);
    expect(read('apps/api/src/infrastructure/notifications/whatsapp/whatsAppTemplates.ts')).toMatch(/tagShopUrl\(trackOrderUrl/);
    expect(read('apps/web/src/pages/admin/orders/[id].astro')).toMatch(/fallbackWaText = tagShopLinks\(fallbackWaText, 'w'\)/);
    expect(JSON.parse(read('apps/web/public/manifest.json')).start_url).toBe('/?ch=a.homescreen');
  });
});

describe('redirects keep the campaign', () => {
  it('carries utm and click ids; the target\'s own parameters win; a fragment stays last', () => {
    expect(carryQuery('/products/new', '?utm_source=sms&gclid=X')).toBe('/products/new?utm_source=sms&gclid=X');
    expect(carryQuery('/shop?category=a', '?category=b&fbclid=Y')).toBe('/shop?category=a&fbclid=Y');
    expect(carryQuery('/faq#returns', '?utm_source=x')).toBe('/faq?utm_source=x#returns');
    expect(carryQuery('/faq', '')).toBe('/faq');
  });
});

describe('server events reach GA4 only inside a GA4 visit, and only from production', () => {
  it('no session id: not sent to GA4 (ads and our own records still have it)', () => {
    const src = read('apps/api/src/infrastructure/telemetry/TelemetryDispatchService.ts');
    const fan = src.indexOf('await fanOutAdConversions(event);');
    const gate = src.indexOf('if (!event.user_data?.ga_session_id)');
    const env = src.indexOf("environmentOf(process.env.NODE_ENV) !== 'production'");
    const send = src.indexOf('const hit = ga4CollectHit(event, measurementId);');
    expect(fan).toBeGreaterThan(0);
    expect(fan).toBeLessThan(env);
    expect(env).toBeLessThan(gate);
    expect(gate).toBeLessThan(send);
  });

  it('the browser holds its beacons for the GA4 session cookie (up to 10 s), never past leaving the page', () => {
    const t = read('apps/web/src/lib/telemetry.ts');
    expect(t).toMatch(/const GA_SESSION_WAIT_MS = 10_000;/);
    expect(t).toMatch(/flushTimer = setTimeout\(flushWhenGaReady, BATCH_FLUSH_MS\)/);
    expect(t).toMatch(/addEventListener\('pagehide'[\s\S]{0,200}flushQueue\(\)/);
    expect(t).toMatch(/gp_staff=/);
  });
});

/** The real loader from BaseLayout, run against a fake page. */
function loaderSource(): string {
  const layout = read('apps/web/src/layouts/BaseLayout.astro');
  const start = layout.indexOf('        (function () {\n        var ua = navigator.userAgent');
  const end = layout.indexOf('        })();', start);
  return layout.slice(start, end + '        })();'.length);
}

function page(href: string, opts: { referrer?: string; cookie?: string; store?: Map<string, string>; ua?: string } = {}) {
  const store = opts.store ?? new Map<string, string>();
  const scripts: Array<{ src?: string; onload?: () => void }> = [];
  const listeners: Record<string, Array<() => void>> = {};
  const loc = { href, hostname: new URL(href).hostname };
  const win: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    window: win, URL, JSON, Date, Math, crypto: globalThis.crypto, decodeURIComponent, encodeURIComponent, Array, Object,
    navigator: { userAgent: opts.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', webdriver: false },
    location: loc,
    history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => { loc.href = u; } },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    document: {
      cookie: opts.cookie ?? '_fp_cid=fp.1.00000000-0000-4000-8000-000000000000', referrer: opts.referrer ?? '', readyState: 'loading',
      createElement: () => { const s: { src?: string; onload?: () => void; async?: boolean } = {}; scripts.push(s); return s; },
      head: { appendChild: () => undefined },
    },
    addEventListener: (t: string, f: () => void) => { (listeners[t] ??= []).push(f); },
    metricsUrl: 'https://metrics.shopgoldplus.com', gtmId: 'GTM-TEST', userId: null, adSignals: false,
  };
  Object.assign(win, ctx);
  ctx.dataLayer = undefined;
  // `window.x = …` and bare `x` must be the same binding, as in a browser.
  const proxy = new Proxy(ctx, { get: (t, k) => (k in t ? t[k as string] : win[k as string]), set: (t, k, v) => { t[k as string] = v; win[k as string] = v; return true; } });
  (proxy as Record<string, unknown>).window = proxy;
  runInNewContext(loaderSource(), proxy as never);
  return { loc, store, scripts, listeners, dl: (win.dataLayer ?? (proxy as Record<string, unknown>).dataLayer) as unknown[] };
}

describe('the tag loader (BaseLayout), run for real', () => {
  it('?ch=s.track becomes utm_source=sms, utm_medium=sms, utm_campaign=track before the tag reads the URL', () => {
    const p = page('https://shopgoldplus.com/track-order?reference=GP-1&ch=s.track');
    const u = new URL(p.loc.href);
    expect([u.searchParams.get('utm_source'), u.searchParams.get('utm_medium'), u.searchParams.get('utm_campaign'), u.searchParams.get('ch'), u.searchParams.get('reference')])
      .toEqual(['sms', 'sms', 'track', null, 'GP-1']);
  });

  it('a landing the tag never saw hands its campaign, click id and referrer to the next page', () => {
    const store = new Map<string, string>();
    page('https://shopgoldplus.com/?utm_source=google&utm_medium=cpc&gclid=ABC', { referrer: 'https://www.google.com/', store });
    expect(JSON.parse(store.get('gp_land')!)).toMatchObject({ r: 'https://www.google.com/' });
    // Tapped on before the tag loaded: the next page has our own site as referrer and no campaign.
    const next = page('https://shopgoldplus.com/products/x', { referrer: 'https://shopgoldplus.com/?utm_source=google', store });
    const u = new URL(next.loc.href);
    expect([u.pathname, u.searchParams.get('utm_source'), u.searchParams.get('utm_medium'), u.searchParams.get('gclid')]).toEqual(['/products/x', 'google', 'cpc', 'ABC']);
    const set = next.dl.find((e) => (e as IArguments)[0] === 'set') as IArguments | undefined;
    expect(set?.[1]).toEqual({ page_referrer: 'https://www.google.com/' });
  });

  it('once the tag has loaded, the landing is done: later pages are left as they are', () => {
    const store = new Map<string, string>();
    const first = page('https://shopgoldplus.com/?utm_source=sms', { store });
    first.listeners.pointerdown[0]();
    first.scripts[0].onload!();
    expect(store.get('gp_ga_seen')).toBe('1');
    expect(store.has('gp_land')).toBe(false);
    const next = page('https://shopgoldplus.com/shop', { referrer: 'https://shopgoldplus.com/', store });
    expect(next.loc.href).toBe('https://shopgoldplus.com/shop');
  });

  it('loads on the first touch, key or scroll, as well as after load', () => {
    const p = page('https://shopgoldplus.com/');
    for (const t of ['load', 'pointerdown', 'keydown', 'touchstart', 'scroll']) expect(p.listeners[t]?.length, t).toBeGreaterThan(0);
    p.listeners.touchstart[0]();
    p.listeners.scroll[0]();
    expect(p.scripts.filter((s) => s.src?.includes('/gtm.js?id=GTM-TEST'))).toHaveLength(1);
  });

  it('staff and our own probes: no tag at all', () => {
    expect(page('https://shopgoldplus.com/', { cookie: 'gp_staff=1' }).dl).toBeUndefined();
    expect(page('https://shopgoldplus.com/', { cookie: 'gp_probe=1' }).dl).toBeUndefined();
    expect(page('https://shopgoldplus.com/', { ua: 'Mozilla/5.0 Chrome/136 Mobile GoldPlusSyntheticProbe' }).dl).toBeUndefined();
  });
});
