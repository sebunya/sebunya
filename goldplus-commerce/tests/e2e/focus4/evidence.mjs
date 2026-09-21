// Focus 4 evidence runner. Against a local storefront (astro dev) backed by
// tests/e2e/focus4/stub-api.mjs. Captures, for the four-image and one-image
// fixtures: screenshots at the 14 required widths, purchase-action geometry,
// the cold-load network trace (no eager secondaries), the intentional-selection
// request, keyboard navigation + focus behaviour, no-JS composition, the
// enrichment-off render, and an axe scan. Writes JSON + PNGs to <out>.
//   node tests/e2e/focus4/evidence.mjs <base-url> <out-dir>
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:4321';
const out = process.argv[3] || 'docs/media/evidence/focus4-local';
mkdirSync(out, { recursive: true });
const WIDTHS = [320, 360, 375, 390, 412, 430, 768, 820, 1024, 1280, 1366, 1440, 1680, 1920];
const FOUR = '/products/goldplus-bluetooth-gp03bt';
const ONE = '/products/fixture-one-image';
const NONE = '/products/fixture-no-image';
const results = { base, at: new Date().toISOString(), geometry: [], network: {}, keyboard: {}, nojs: {}, axe: {}, enrichmentOff: null, thumbFailure: null };

const browser = await chromium.launch();

async function geometry(page, path, w, h) {
  return page.evaluate(({ path }) => {
    const bb = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; };
    const add = [...document.querySelectorAll('button')].find((b) => /add to cart/i.test(b.textContent || ''));
    const gallery = document.querySelector('[data-gallery]');
    const stageImg = document.querySelector('[data-gallery-image]');
    const previews = [...document.querySelectorAll('[data-gallery-preview]')];
    const spec = document.querySelector('table caption');
    const h1s = document.querySelectorAll('h1').length;
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return { path, addToCart: bb(add), gallery: bb(gallery), stage: bb(stageImg), previews: previews.map((p) => bb(p)), specTable: bb(spec?.closest('table')), h1Count: h1s, horizontalOverflow: overflow, docHeight: document.documentElement.scrollHeight };
  }, { path });
}

// 1. Geometry + screenshots across widths
for (const w of WIDTHS) {
  const h = w < 700 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 700 ? 3 : 1, isMobile: w < 700 });
  for (const [label, path] of [['four', FOUR], ['one', ONE]]) {
    const page = await ctx.newPage();
    await page.goto(base + path, { waitUntil: 'networkidle' });
    const g = await geometry(page, path, w, h);
    results.geometry.push({ width: w, height: h, label, ...g, actionVisibleWithoutScroll: g.addToCart ? g.addToCart.top + g.addToCart.h <= h : null, actionBeforeSpecTable: g.addToCart && g.specTable ? g.addToCart.top < g.specTable.top : null });
    if ([390, 820, 1440, 1920].includes(w)) {
      await page.screenshot({ path: join(out, `${label}-${w}-fold.png`) });
      await page.screenshot({ path: join(out, `${label}-${w}-full.png`), fullPage: true });
    }
    await page.close();
  }
  await ctx.close();
}

// 2. Cold-load network: cover + thumbs only; then one large request on selection
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Record gallery renditions with their response status: a 200 is a download, a 304 is the
  // dev server revalidating (production serves these immutable, so a 304 never happens there);
  // a memory-cache hit emits no request at all.
  const requests = [];
  page.on('response', (r) => { const u = r.url().replace(base, ''); if (/\/uploads\/assets\/f[1-4]\//.test(u)) requests.push({ url: u, status: r.status() }); });
  await page.goto(base + FOUR, { waitUntil: 'networkidle' });
  const cold = [...requests];
  requests.length = 0;
  await page.click('[data-gallery-preview] >> nth=1'); // third image (preview index 1)
  await page.waitForFunction(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim().startsWith('3'), null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const afterSelect = [...requests];
  const downloads = (list) => [...new Set(list.filter((r) => r.status === 200).map((r) => r.url))];
  // Other components on the page (the recently-viewed rail renders this product's cover as a
  // card after the visit is recorded) also request the cover; count them so the gallery's own
  // behaviour is read correctly. The dev server sends no cache headers, so repeated <img>
  // elements re-download; production serves these URLs immutable.
  const coverImgsOutsideGallery = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => /f1\/fixture1fixture\/pdp\.webp/.test(i.currentSrc || i.src) && !i.closest('[data-gallery]')).length);
  const coldU = downloads(cold); const selU = downloads(afterSelect);
  results.network = {
    coldLoadRaw: cold, afterSelectingThirdRaw: afterSelect,
    coldUnique: coldU, selectUnique: selU, coverImgsOutsideGallery,
    coldHasLargeSecondary: coldU.some((u) => /f[234]\/.*pdp\.webp/.test(u)),
    coldIsCoverPlusThumbs: coldU.filter((u) => /pdp\.webp/.test(u)).every((u) => /f1\//.test(u)) && coldU.filter((u) => /thumb\.webp/.test(u)).length === 3,
    selectLoadedThirdLarge: selU.some((u) => /f3\/.*pdp\.webp/.test(u)),
    selectLoadedNoOtherSecondaryLarge: !selU.some((u) => /f[24]\/.*pdp\.webp/.test(u)),
    selectLoadedCoverThumb: selU.some((u) => /f1\/.*thumb\.webp/.test(u)),
    selectReloadedCoverLargeByGallery: selU.some((u) => /f1\/.*pdp\.webp/.test(u)) && coverImgsOutsideGallery === 0,
  };
  await page.screenshot({ path: join(out, 'four-1440-secondary-active.png') });
  const composition = await page.evaluate(() => ({ counter: document.querySelector('[data-gallery-counter]')?.textContent?.trim(), previews: [...document.querySelectorAll('[data-gallery-preview]')].map((a) => a.getAttribute('aria-label')), activeAlt: document.querySelector('[data-gallery-image]')?.getAttribute('alt') }));
  results.network.compositionAfterSelect = composition;
  await ctx.close();
}

// 3. Keyboard + focus: arrows, Home/End, focus never stranded, tab-away not pulled back
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + FOUR, { waitUntil: 'networkidle' });
  await page.focus('[data-gallery-preview] >> nth=0');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim().startsWith('2'));
  const afterEnter = await page.evaluate(() => ({ counter: document.querySelector('[data-gallery-counter]')?.textContent?.trim(), focusedIs: document.activeElement?.getAttribute('data-gallery-controls') !== null ? 'controls' : document.activeElement?.tagName, focusInGallery: !!document.activeElement?.closest('[data-gallery]'), status: document.querySelector('[data-gallery-status]')?.textContent }));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim().startsWith('3'));
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim().startsWith('4'));
  const atEnd = await page.evaluate(() => ({ counter: document.querySelector('[data-gallery-counter]')?.textContent?.trim(), nextDisabled: document.querySelector('[data-gallery-next]')?.disabled }));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const noWrap = await page.evaluate(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim());
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim().startsWith('1'));
  // Tab away during a load: focus must not be pulled back. Throttle to make the load slow.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 20000, uploadThroughput: 20000 });
  await page.focus('[data-gallery-preview] >> nth=2');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const focusedBefore = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60));
  await page.waitForFunction(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim().startsWith('4'), null, { timeout: 15000 }).catch(() => null);
  const focusedAfter = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  results.keyboard = { afterEnter, atEnd, noWrapCounter: noWrap, tabAwayNotPulledBack: focusedBefore === focusedAfter, focusedBefore, focusedAfter };
  await ctx.close();
}

// 4. No-JS: cover renders, previews are links, arrows hidden
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + FOUR, { waitUntil: 'load' });
  results.nojs = await page.evaluate(() => ({ cover: !!document.querySelector('[data-gallery-image]'), previewLinks: [...document.querySelectorAll('[data-gallery-preview]')].map((a) => a.getAttribute('href')), arrowsHidden: [...document.querySelectorAll('[data-gallery-prev],[data-gallery-next]')].every((b) => b.hidden), buyForm: !!document.querySelector('form[action="/cart"]') }));
  await page.screenshot({ path: join(out, 'four-1440-nojs.png') });
  await ctx.close();
}

// 5. Thumbnail failure separation: block one thumb; its full image must still be selectable
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/uploads/assets/f3/**/thumb.webp', (r) => r.abort());
  await page.goto(base + FOUR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const labelled = await page.evaluate(() => [...document.querySelectorAll('[data-gallery-preview]')].map((a) => ({ label: a.getAttribute('aria-label'), thumbFailed: a.hasAttribute('data-thumb-failed'), text: a.textContent?.trim() })));
  await page.click('[data-gallery-preview][data-thumb-failed]');
  await page.waitForFunction(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim().startsWith('3'), null, { timeout: 5000 }).catch(() => null);
  results.thumbFailure = { previews: labelled, selectedAfterThumbFailure: await page.evaluate(() => document.querySelector('[data-gallery-counter]')?.textContent?.trim()) };
  await page.screenshot({ path: join(out, 'four-1440-thumb-failed.png') });
  await ctx.close();
}

// 6. No-image fallback + axe on the four-image page
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + NONE, { waitUntil: 'networkidle' });
  results.noImage = await page.evaluate(() => ({ fallbackText: document.body.textContent?.includes('No photo of this one yet'), gallery: !!document.querySelector('[data-gallery]') }));
  await page.goto(base + FOUR, { waitUntil: 'networkidle' });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-gallery]').analyze();
  results.axe = { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })), passes: axe.passes.length };
  await ctx.close();
}

await browser.close();
writeFileSync(join(out, 'evidence.json'), JSON.stringify(results, null, 2));
const g = results.geometry;
console.log('widths with horizontal overflow:', g.filter((x) => x.horizontalOverflow).map((x) => `${x.label}@${x.width}`));
console.log('four-image action visible without scroll @1440:', g.find((x) => x.width === 1440 && x.label === 'four')?.actionVisibleWithoutScroll, 'top', g.find((x) => x.width === 1440 && x.label === 'four')?.addToCart?.top);
console.log('four-image action before spec table @390:', g.find((x) => x.width === 390 && x.label === 'four')?.actionBeforeSpecTable, 'top', g.find((x) => x.width === 390 && x.label === 'four')?.addToCart?.top);
console.log('cold unique:', JSON.stringify(results.network.coldUnique), '| cover+thumbs only?', results.network.coldIsCoverPlusThumbs, '| eager secondary?', results.network.coldHasLargeSecondary);
console.log('select unique:', JSON.stringify(results.network.selectUnique), '| third large loaded?', results.network.selectLoadedThirdLarge, '| no other secondary large?', results.network.selectLoadedNoOtherSecondaryLarge, '| cover thumb loaded?', results.network.selectLoadedCoverThumb, '| cover large reloaded by gallery?', results.network.selectReloadedCoverLargeByGallery, '| cover imgs outside gallery:', results.network.coverImgsOutsideGallery);
console.log('keyboard:', JSON.stringify(results.keyboard));
console.log('nojs:', JSON.stringify(results.nojs));
console.log('thumb failure:', JSON.stringify(results.thumbFailure));
console.log('axe violations:', results.axe.violations?.length, JSON.stringify(results.axe.violations));
