import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { page, sets } from './helpers/tagLoader';
import { smsSegments, tagShopLinks, tagShopLinksInSms, tagShopUrl } from '../../packages/shared/src/links/shopLinkTag';
import { carryQuery } from '../../apps/web/src/lib/carryQuery';
import { formatWhatsAppReply } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';
import { formatSocialReply } from '../../apps/api/src/domain/assistant/SocialGoldie';
import { classifyChannel } from '../../apps/api/src/domain/measurement/Channels';
import { inAppReferrerHost } from '../../apps/web/src/lib/inAppBrowser';
import { ANALYTICS_REDACTED_PARAMS, analyticsSafeUrl } from '../../packages/shared/src/links/analyticsSafeUrl';
import { ga4CollectHit } from '../../apps/api/src/infrastructure/telemetry/Ga4CollectHit';
import { campaignOnRedirect } from '../../apps/web/src/lib/carryQuery';

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

  it('the browser holds its beacons for a current GA4 session cookie (up to 15 s), never past hiding or leaving the page', () => {
    const t = read('apps/web/src/lib/telemetry.ts');
    expect(t).toMatch(/const GA_SESSION_WAIT_MS = 15_000;/);
    expect(t).toMatch(/visibilitychange[\s\S]{0,200}flushQueue\(\)/);
    expect(t).toMatch(/flushTimer = setTimeout\(flushWhenGaReady, BATCH_FLUSH_MS\)/);
    expect(t).toMatch(/addEventListener\('pagehide'[\s\S]{0,200}flushQueue\(\)/);
    expect(t).toMatch(/gp_staff=/);
  });
});

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
    // Only the visitor's own share marker (#s=…) is added: no campaign carried over.
    expect(next.loc.href.replace(/#s=[a-z0-9]{6}$/, '')).toBe('https://shopgoldplus.com/shop');
  });

  it('loads on the first touch, key or scroll, as well as after load', () => {
    const p = page('https://shopgoldplus.com/');
    for (const t of ['load', 'pointerdown', 'keydown', 'touchstart', 'scroll']) expect(p.listeners[t]?.length, t).toBeGreaterThan(0);
    p.listeners.touchstart[0]();
    p.listeners.scroll[0]();
    expect(p.scripts.filter((s) => s.src?.includes('/gtm.js?id=GTM-TEST'))).toHaveLength(1);
  });

  it('every channel tag lands in the right channel of our own reports', () => {
    const want: Record<string, string> = { s: 'sms', w: 'whatsapp', e: 'email', m: 'organic_social', i: 'organic_social', a: 'direct' };
    for (const [c, channel] of Object.entries(want)) {
      const u = new URL(page(`https://shopgoldplus.com/?ch=${c}.track`).loc.href);
      expect(classifyChannel({ source: u.searchParams.get('utm_source'), medium: u.searchParams.get('utm_medium') }), c).toBe(channel);
    }
  });

  it('a social app\'s own browser (no referrer) is credited to that network, the same in GA4 and our records', () => {
    const uas: Record<string, string | null> = {
      'Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 312.0.0.0 (iPhone14,5; iOS 17_0)': 'instagram.com',
      'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]': 'facebook.com',
      'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile [FB_IAB/Orca-Android;FBAV/440.0;]': 'facebook.com',
      'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile musical_ly_2023 BytedanceWebview/d8a21c6': 'tiktok.com',
      'Mozilla/5.0 (iPhone) Snapchat/13.10.0.40 (like Safari)': 'snapchat.com',
      'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36': null,
    };
    for (const [ua, host] of Object.entries(uas)) {
      expect(inAppReferrerHost(ua), ua).toBe(host);
      const store = new Map<string, string>();
      const p = page('https://shopgoldplus.com/products/x', { ua, store });
      const set = p.dl.find((e) => (e as IArguments)[0] === 'set') as IArguments | undefined;
      expect(set?.[1] ?? null, ua).toEqual(host ? { page_referrer: `https://${host}/` } : null);
      if (host) expect(classifyChannel({ referrerHost: host }), ua).toBe('organic_social');
    }
    // A tagged link keeps its own source.
    const tagged = page('https://shopgoldplus.com/?utm_source=newsletter&utm_medium=email', { ua: 'Mozilla/5.0 Instagram 312.0.0.0' });
    expect(tagged.dl.find((e) => (e as IArguments)[0] === 'set')).toBeUndefined();
  });

  it('staff and our own probes: no tag at all', () => {
    expect(page('https://shopgoldplus.com/', { cookie: 'gp_staff=1' }).dl).toBeUndefined();
    expect(page('https://shopgoldplus.com/', { cookie: 'gp_probe=1' }).dl).toBeUndefined();
    expect(page('https://shopgoldplus.com/', { ua: 'Mozilla/5.0 Chrome/136 Mobile GoldPlusSyntheticProbe' }).dl).toBeUndefined();
  });
});


describe('what GA4 may see of an address (second pass)', () => {
  it('identifier values are replaced, names and campaigns kept', () => {
    expect(analyticsSafeUrl('https://shopgoldplus.com/gift-card/bought?ref=GC-8F3K&utm_source=sms'))
      .toBe('https://shopgoldplus.com/gift-card/bought?ref=redacted&utm_source=sms');
    expect(analyticsSafeUrl('https://shopgoldplus.com/checkout/pay?ref=GP-1&u=https%3A%2F%2Fpay.pesapal.com%2Fx&net=MTN'))
      .toBe('https://shopgoldplus.com/checkout/pay?ref=redacted&u=redacted&net=MTN');
    expect(analyticsSafeUrl('https://shopgoldplus.com/shop?q=power+bank')).toBe('https://shopgoldplus.com/shop?q=power+bank');
  });

  it('server hits carry the redacted address and referrer', () => {
    const p = ga4CollectHit({ event_name: 'view_item', event_id: 'e1', user_data: { fp_client_id: 'fp.1.x' },
      page_location: 'https://shopgoldplus.com/track-order?reference=GP-1', page_referrer: 'https://shopgoldplus.com/review?reference=GP-1' } as never, 'G-X')!;
    expect([p.get('dl'), p.get('dr')]).toEqual(['https://shopgoldplus.com/track-order?reference=redacted', 'https://shopgoldplus.com/review?reference=redacted']);
  });

  it('the browser hits too: page_location and an internal referrer, redacted', () => {
    const p = page('https://shopgoldplus.com/gift-card/bought?ref=GC-8F3K', { referrer: 'https://shopgoldplus.com/track-order?reference=GP-1' });
    expect(sets(p.dl)).toEqual({ page_location: 'https://shopgoldplus.com/gift-card/bought?ref=redacted', page_referrer: 'https://shopgoldplus.com/track-order?reference=redacted' });
    expect(sets(page('https://shopgoldplus.com/shop').dl)).toEqual({});
  });

  it('a return from Pesapal is not an arrival: our own origin as referrer, no landing kept', () => {
    const store = new Map<string, string>();
    const p = page('https://shopgoldplus.com/checkout/pesapal/callback?OrderTrackingId=abc', { referrer: 'https://pay.pesapal.com/iframe/x', store });
    expect(sets(p.dl)).toEqual({ page_location: 'https://shopgoldplus.com/checkout/pesapal/callback?OrderTrackingId=redacted', page_referrer: 'https://shopgoldplus.com/' });
    expect(store.has('gp_land')).toBe(false);
  });

  it('the loader\'s lists come from the rulebook, as data (it has none of its own)', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('var RED = new RegExp(rules.red, \'i\');');
    expect(layout).toContain("const arrivalRules = { ...loaderRules(), red: ANALYTICS_REDACTED_PARAMS.source, bots: DECLARED.source };");
    expect(layout).not.toMatch(/pesapal\\\.com|FB_IAB|fbclid: 'facebook\.com'|ordertrackingid/);
  });

  it('a page that carried the landing is marked, and our landing recorder does not file it again', () => {
    const store = new Map<string, string>();
    page('https://shopgoldplus.com/?utm_source=sms&utm_medium=sms', { store });
    const next = page('https://shopgoldplus.com/shop', { referrer: 'https://shopgoldplus.com/', store });
    expect(next.win.__gpCarried).toBe(true);
    expect(read('apps/web/src/lib/telemetry.ts')).toMatch(/if \(\(window as \{ __gpCarried\?: boolean \}\)\.__gpCarried\) return;/);
  });
});

describe('loose ends (second pass)', () => {
  it('a passive view joins the visit but does not make it engaged; an action does', () => {
    const hit = (event_name: string) => ga4CollectHit({ event_name, event_id: 'e', user_data: { fp_client_id: 'fp.1.x', ga_session_id: '1792731618', ga_session_number: 2 } } as never, 'G-X')!;
    for (const e of ['view_item', 'view_item_list']) expect([hit(e).get('sid'), hit(e).get('seg')], e).toEqual(['1792731618', null]);
    for (const e of ['add_to_cart', 'begin_checkout', 'purchase', 'generate_lead', 'search']) expect(hit(e).get('seg'), e).toBe('1');
  });

  it('every same-site redirect keeps the campaign tags (the sign-in redirects built from the path alone)', () => {
    const req = new URL('https://shopgoldplus.com/account/loyalty?ch=s.loyalty&gclid=G1&other=1');
    expect(campaignOnRedirect('/login?returnTo=/account/loyalty', req)).toBe('/login?returnTo=%2Faccount%2Floyalty&ch=s.loyalty&gclid=G1');
    expect(campaignOnRedirect('https://pay.pesapal.com/x', req)).toBeNull();
    expect(campaignOnRedirect('//evil.example/x', req)).toBeNull();
    expect(campaignOnRedirect('/login?ch=s.loyalty&gclid=G1', req)).toBeNull();
    expect(campaignOnRedirect('/login', new URL('https://shopgoldplus.com/account'))).toBeNull();
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toMatch(/response\.status >= 301 && response\.status <= 308[\s\S]{0,200}campaignOnRedirect\(loc, context\.url\)/);
  });

  it('Clarity has the same gate as the GA4 tag (probes and staff)', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout.match(/\/\(\?:\^\|; \)\(\?:gp_probe\|gp_staff\)=\/\.test\(document\.cookie\)/g)).toHaveLength(2);
  });
});

describe('a social network\'s click id is not an ad (no ad has ever run; 10 of 10 fbclid arrivals were shares)', () => {
  it('our reports: fbclid untagged is organic social; tagged paid, it is paid social; ad click ids stay paid', () => {
    expect(classifyChannel({ clickIdTypes: ['fbclid'] })).toBe('organic_social');
    expect(classifyChannel({ clickIdTypes: ['fbclid'], referrerHost: 'm.facebook.com' })).toBe('organic_social');
    expect(classifyChannel({ clickIdTypes: ['fbclid'], source: 'fb', medium: 'paid_social' })).toBe('paid_social');
    expect(classifyChannel({ clickIdTypes: ['fbclid'], source: 'facebook', medium: 'cpc' })).toBe('paid_social');
    expect(classifyChannel({ source: 'ig', medium: 'paid' })).toBe('paid_social');
    // Ad-only ids still prove an ad; Google's stay paid search; a YouTube cpc tag stays where it was.
    for (const c of ['ttclid', 'sccid', 'li_fat_id', 'twclid', 'epik']) expect(classifyChannel({ clickIdTypes: [c] }), c).toBe('paid_social');
    expect(classifyChannel({ clickIdTypes: ['gclid'] })).toBe('paid_search');
    expect(classifyChannel({ source: 'youtube', medium: 'cpc' })).toBe('paid_search');
    expect(classifyChannel({ source: 'google', medium: 'cpc' })).toBe('paid_search');
  });

  it('GA4: an untagged fbclid visit with no referrer is credited to Facebook (it was Direct); Instagram\'s browser wins', () => {
    expect(sets(page('https://shopgoldplus.com/products/x?fbclid=IwAR123').dl)).toEqual({ page_referrer: 'https://facebook.com/' });
    expect(sets(page('https://shopgoldplus.com/products/x?fbclid=IwAR123', { ua: 'Mozilla/5.0 (iPhone) Instagram 312.0.0.0' }).dl)).toEqual({ page_referrer: 'https://instagram.com/' });
    // Its own referrer, or campaign tags, are left alone.
    expect(sets(page('https://shopgoldplus.com/?fbclid=IwAR123', { referrer: 'https://m.facebook.com/' }).dl)).toEqual({});
    expect(sets(page('https://shopgoldplus.com/?fbclid=IwAR1&utm_source=fb&utm_medium=paid_social').dl)).toEqual({});
  });

  it('Snapchat\'s click id (ScCid, mixed case) is carried to the next page like the others', () => {
    const store = new Map<string, string>();
    page('https://shopgoldplus.com/?ScCid=abc', { store });
    const next = page('https://shopgoldplus.com/shop', { referrer: 'https://shopgoldplus.com/', store });
    expect(new URL(next.loc.href).searchParams.get('ScCid')).toBe('abc');
  });

  it('the order source and the landing touch agree: fbclid without tags names Facebook, not paid', () => {
    const a = read('apps/web/src/lib/attribution.ts');
    expect(a).not.toMatch(/if \(p\.get\('fbclid'\)\) return 'facebook';\n\s*if \(p\.get\('ttclid'\)\)/);
    // Both read the one rulebook (behaviour is proven in AttributionContract.test.ts).
    expect(a).toMatch(/untaggedArrivalHost\(new URLSearchParams\(location\.search\), navigator\.userAgent/);
    expect(read('apps/web/src/lib/telemetry.ts')).toMatch(/const t = landingTouch\(\{ search: location\.search/);
  });
});
