import { beforeEach, describe, expect, it, vi } from 'vitest';
import { landingTouch } from '../../packages/shared/src/attribution/arrival';
import { classifyChannel } from '../../apps/api/src/domain/measurement/Channels';
import { page, sets } from './helpers/tagLoader';

/**
 * The attribution contract (2026-10-23). Where a visit came from is decided in five places: the tag loader (what GA4
 * is told), the landing touch + the API's channel classifier (our reports), and lib/attribution (an order's source).
 * Every bug in the 2026-10-23 audit was one of them drifting from another. Each row below is a real kind of arrival
 * and what ALL of them must say about it; the row runs through the real code of each, in the order a page runs it
 * (the loader first, so the order source reads the address the loader left).
 */
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const FB_APP = `${ANDROID} [FB_IAB/FB4A;FBAV/480.0.0.0;]`;
const IG_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Instagram 312.0.0.0 (iPhone14,5; iOS 17_0)';

interface Row {
  name: string;
  url: string;
  referrer?: string;
  ua?: string;
  /** What GA4 is told beyond the browser's own referrer (null: nothing; GA4 reads the real one). */
  ga4Referrer: string | null;
  /** utm_source / utm_medium GA4 reads from the address (after the loader). */
  ga4Utm?: [string, string];
  /** GA4's default channel for it (documentation of intent; GA4 decides from the two lines above). */
  ga4Channel: string;
  /** Our channel report. */
  channel: string;
  /** The order's recorded source / medium. */
  order: [string | null, string | null];
}

const ROWS: Row[] = [
  { name: 'Google search', url: '/products/x', referrer: 'https://www.google.com/', ga4Referrer: null, ga4Channel: 'Organic Search', channel: 'organic_search', order: ['google', 'organic'] },
  { name: 'Google ad (auto-tagged)', url: '/products/x?gclid=Cj0K', referrer: 'https://www.google.com/', ga4Referrer: null, ga4Channel: 'Paid Search', channel: 'paid_search', order: ['google', 'cpc'] },
  { name: 'Facebook share, Facebook passed a referrer', url: '/products/x?fbclid=IwAR1abcdefgh', referrer: 'https://m.facebook.com/', ga4Referrer: null, ga4Channel: 'Organic Social', channel: 'organic_social', order: ['facebook', 'social'] },
  { name: 'Facebook share opened in Facebook\'s own browser (no referrer)', url: '/products/x?fbclid=IwAR1abcdefgh', ua: FB_APP, ga4Referrer: 'https://facebook.com/', ga4Channel: 'Organic Social', channel: 'organic_social', order: ['facebook', 'social'] },
  { name: 'Instagram link (carries fbclid) in Instagram\'s browser', url: '/products/x?fbclid=IwAR1abcdefgh', ua: IG_APP, ga4Referrer: 'https://instagram.com/', ga4Channel: 'Organic Social', channel: 'organic_social', order: ['instagram', 'social'] },
  { name: 'fbclid, no referrer, ordinary browser', url: '/products/x?fbclid=IwAR1abcdefgh', ga4Referrer: 'https://facebook.com/', ga4Channel: 'Organic Social', channel: 'organic_social', order: ['facebook', 'social'] },
  { name: 'Meta ad tagged as the docs say', url: '/products/x?utm_source=fb&utm_medium=paid_social&utm_campaign=launch&fbclid=IwAR1abcdefgh', ua: FB_APP, ga4Referrer: null, ga4Utm: ['fb', 'paid_social'], ga4Channel: 'Paid Social', channel: 'paid_social', order: ['fb', 'paid_social'] },
  { name: 'TikTok ad (ttclid)', url: '/products/x?ttclid=E.C.P.abc', ga4Referrer: null, ga4Channel: 'Direct (GA4 ignores ttclid: tag TikTok ads)', channel: 'paid_social', order: ['tiktok', 'paid_social'] },
  { name: 'X ad (twclid)', url: '/products/x?twclid=2-abc', ga4Referrer: null, ga4Channel: 'Direct (GA4 ignores twclid: tag X ads)', channel: 'paid_social', order: ['x', 'paid_social'] },
  { name: 'Our SMS link', url: '/track-order?reference=GP-1&ch=s.track', ga4Referrer: null, ga4Utm: ['sms', 'sms'], ga4Channel: 'SMS', channel: 'sms', order: ['sms', 'sms'] },
  { name: 'Our email link', url: '/review?reference=GP-1&ch=e.review', ga4Referrer: null, ga4Utm: ['goldplus', 'email'], ga4Channel: 'Email', channel: 'email', order: ['goldplus', 'email'] },
  { name: 'Goldie\'s link in Messenger (Messenger adds fbclid)', url: '/products/x?ch=m.goldie&fbclid=IwAR1abcdefgh', ua: FB_APP, ga4Referrer: null, ga4Utm: ['messenger', 'chat'], ga4Channel: 'Messaging (GoldPlus channels)', channel: 'organic_social', order: ['messenger', 'chat'] },
  { name: 'A customer\'s invite link', url: '/invite?code=AB12&utm_source=customer_invite&utm_medium=friend&utm_campaign=refer_a_friend', ga4Referrer: null, ga4Utm: ['customer_invite', 'friend'], ga4Channel: 'Friend referrals (GoldPlus channels)', channel: 'friend_referral', order: ['customer_invite', 'friend'] },
  { name: 'A QR code on the packaging (?ch=q.packaging)', url: '/?ch=q.packaging', ga4Referrer: null, ga4Utm: ['qr', 'print'], ga4Channel: 'Print and QR (GoldPlus channels)', channel: 'print', order: ['qr', 'print'] },
  { name: 'A product shared from its page (Share on WhatsApp)', url: '/products/x?utm_source=customer_share&utm_medium=friend&utm_campaign=product_share&utm_content=whatsapp', ga4Referrer: null, ga4Utm: ['customer_share', 'friend'], ga4Channel: 'Friend referrals (GoldPlus channels)', channel: 'friend_referral', order: ['customer_share', 'friend'] },
  { name: 'Installed app', url: '/?ch=a.homescreen', ga4Referrer: null, ga4Utm: ['app', 'pwa'], ga4Channel: 'App (GoldPlus channels)', channel: 'direct', order: ['app', 'pwa'] },
  { name: 'Untagged WhatsApp link (WhatsApp sends nothing)', url: '/products/x', ga4Referrer: null, ga4Channel: 'Direct', channel: 'direct', order: [null, null] },
  { name: 'A product link someone copied into WhatsApp (dark social), opened by a friend', url: '/products/x#s=k3j9q2', ga4Referrer: null, ga4Utm: ['shared_link', 'friend'], ga4Channel: 'Friend referrals (GoldPlus channels)', channel: 'friend_referral', order: ['shared_link', 'friend'] },
  { name: 'A copied link that also came through Facebook (its referrer wins)', url: '/products/x#s=k3j9q2', referrer: 'https://l.facebook.com/', ga4Referrer: null, ga4Channel: 'Organic Social', channel: 'organic_social', order: ['facebook', 'social'] },
  { name: 'A copied link that already carries tags (the tags win)', url: '/products/x?ch=s.track#s=k3j9q2', ga4Referrer: null, ga4Utm: ['sms', 'sms'], ga4Channel: 'SMS', channel: 'sms', order: ['sms', 'sms'] },
  { name: 'Back from Pesapal after paying', url: '/checkout/pesapal/callback?OrderTrackingId=abc', referrer: 'https://pay.pesapal.com/iframe/x', ga4Referrer: 'https://shopgoldplus.com/', ga4Channel: '(continues the visit)', channel: 'direct', order: [null, null] },
];

describe('the attribution contract: every reader says the same thing about each arrival', () => {
  const store = new Map<string, string>();
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules(); store.clear(); });

  for (const r of ROWS) {
    it(r.name, async () => {
      const href = `https://shopgoldplus.com${r.url}`;
      const ua = r.ua ?? ANDROID;
      const referrer = r.referrer ?? '';

      // 1. The tag loader: what GA4 is told.
      const p = page(href, { referrer, ua });
      const told = sets(p.dl);
      expect(told.page_referrer ?? null, 'GA4 page_referrer').toBe(r.ga4Referrer);
      const after = new URL(p.loc.href);
      if (r.ga4Utm) expect([after.searchParams.get('utm_source'), after.searchParams.get('utm_medium')], 'GA4 utm').toEqual(r.ga4Utm);
      expect(r.ga4Channel).toBeTruthy();

      // 2. Our landing touch and channel report, from the address the loader left.
      const t = landingTouch({ search: after.search, referrer, ua, selfHost: 'shopgoldplus.com' });
      expect(classifyChannel(t), 'channel report').toBe(r.channel);

      // 3. The order's source, from the same address.
      vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
      vi.stubGlobal('location', { search: after.search, pathname: after.pathname, host: 'shopgoldplus.com' });
      vi.stubGlobal('navigator', { userAgent: ua });
      vi.stubGlobal('document', { referrer, cookie: '' });
      const a = await import('../../apps/web/src/lib/attribution');
      a.captureAttribution(); a.recordAdClick();
      const o = a.getCheckoutAttribution();
      expect([o?.source ?? null, o?.medium ?? null], 'order source / medium').toEqual(r.order);
    });
  }

  it('dark social: the sharer reopening their own copied link is not a share; the marker never lands on private pages', () => {
    const local = new Map<string, string>([['gp_st', 'k3j9q2']]);
    const own = page('https://shopgoldplus.com/products/x#s=k3j9q2', { local });
    expect(new URL(own.loc.href).searchParams.get('utm_source')).toBeNull();
    expect(own.loc.href).toBe('https://shopgoldplus.com/products/x#s=k3j9q2');
    // Every shareable page gets the visitor's own marker; checkout, account, order and gift card pages never do.
    const fresh = new Map<string, string>();
    expect(page('https://shopgoldplus.com/products/x', { local: fresh }).loc.href).toMatch(/\/products\/x#s=[a-z0-9]{6}$/);
    expect(fresh.get('gp_st')).toMatch(/^[a-z0-9]{6}$/);
    for (const path of ['/checkout', '/account/orders', '/track-order?reference=GP-1', '/gift-card/open', '/r/AB12', '/login']) {
      expect(page(`https://shopgoldplus.com${path}`, { local: new Map() }).loc.hash, path).toBe('');
    }
    // A page that already uses its # (an anchor) is left alone.
    expect(page('https://shopgoldplus.com/faq#returns', { local: new Map() }).loc.hash).toBe('#returns');
  });

  it('the product share link: the clean page address, the friend-referral tags, and how it went', async () => {
    const { productShareUrl } = await import('../../packages/shared/src/attribution/arrival');
    expect(productShareUrl('https://shopgoldplus.com/products/x?search=pb&rank=2#s=k3j9q2', 'whatsapp'))
      .toBe('https://shopgoldplus.com/products/x?utm_source=customer_share&utm_medium=friend&utm_campaign=product_share&utm_content=whatsapp');
    expect(productShareUrl('https://shopgoldplus.com/products/x', 'copy')).toMatch(/utm_content=copy$/);
    const pdp = (await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, '../../apps/web/src/pages/products/[slug].astro'), 'utf8');
    expect(pdp).toContain("productShareUrl(canonical, 'whatsapp')");
    expect(pdp).toMatch(/https:\/\/wa\.me\/\?text=/);
  });

  it('no reader keeps its own copy of the rules', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
    // The lists live only in the rulebook; the readers import it (the loader receives it as data).
    const lists = /pesapal\\\.com|FB_IAB|Instagram\\s|'twclid'|fbclid: '|ordertrackingid|shared_link|copied_link|customer_share|\['sms', 'sms'\]/;
    for (const f of ['apps/web/src/layouts/BaseLayout.astro', 'apps/web/src/lib/attribution.ts', 'apps/web/src/lib/telemetry.ts', 'apps/web/src/lib/inAppBrowser.ts', 'apps/web/src/lib/internalReferrer.ts', 'apps/api/src/domain/measurement/Channels.ts']) {
      expect(src(f), f).not.toMatch(lists);
    }
  });
});
