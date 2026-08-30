import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLikelyHuman } from '../../apps/web/src/lib/humanTraffic';

/**
 * Search demand is a PURCHASING signal — the admin queue built from it tells the
 * owner what to buy. Production proved what happens without this: 7,215 of
 * 7,235 recorded searches arrived in three days of automated probing, so
 * queries no customer ever typed showed as hundreds of lost sales.
 */
describe('only people register demand', () => {
  const browser = 'Mozilla/5.0 (Linux; Android 13; Infinix X6819) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';

  it('a real browser counts', () => {
    expect(isLikelyHuman(browser)).toBe(true);
    expect(isLikelyHuman('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')).toBe(true);
  });

  it('command-line tools do not', () => {
    for (const ua of ['curl/8.5.0', 'Wget/1.21', 'python-requests/2.31', 'node', 'axios/1.6', 'PostmanRuntime/7.36']) {
      expect(isLikelyHuman(ua), ua).toBe(false);
    }
  });

  it('crawlers and SEO tools do not', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Bytespider',
    ]) {
      expect(isLikelyHuman(ua), ua).toBe(false);
    }
  });

  it('monitors and headless browsers do not', () => {
    for (const ua of ['UptimeRobot/2.0', 'Mozilla/5.0 HeadlessChrome/120', 'Chrome-Lighthouse', 'Pingdom.com_bot']) {
      expect(isLikelyHuman(ua), ua).toBe(false);
    }
  });

  it('a missing user agent is a script, not a shy customer', () => {
    expect(isLikelyHuman('')).toBe(false);
    expect(isLikelyHuman(null)).toBe(false);
    expect(isLikelyHuman(undefined)).toBe(false);
    expect(isLikelyHuman('   ')).toBe(false);
  });

  it('link previewers do not count — nobody searched, a message was pasted', () => {
    expect(isLikelyHuman('WhatsApp/2.23')).toBe(false);
    expect(isLikelyHuman('facebookexternalhit/1.1')).toBe(false);
  });

  it('the shop records demand only for people', () => {
    const shop = readFileSync(resolve(__dirname, '../../apps/web/src/pages/shop.astro'), 'utf8');
    expect(shop).toMatch(/if \(search && isLikelyHuman\(Astro\.request\.headers\.get\('user-agent'\)\)\)/);
  });

  it('the storefront search itself still works for everyone, human or not', () => {
    // The gate is on RECORDING only. A crawler must still get real results, or
    // the pages it indexes would differ from what a customer sees.
    const shop = readFileSync(resolve(__dirname, '../../apps/web/src/pages/shop.astro'), 'utf8');
    const filterLine = shop.slice(shop.indexOf('const filteredProducts'), shop.indexOf('const filteredProducts') + 200);
    expect(filterLine).not.toMatch(/isLikelyHuman/);
  });
});
