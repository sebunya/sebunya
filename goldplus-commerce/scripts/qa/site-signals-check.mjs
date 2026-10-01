// Real Chromium against the local storefront + API: do the three site signals leave the browser, and does the collector accept them?
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('@playwright/test');
const WEB = process.env.WEB;
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); if (!ok) failed += 1; };
// As a shopper's browser: not flagged as automation (the storefront and the collector both drop our own robots).
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ baseURL: WEB, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
const beacons = [];   // { event, status }
// The local build bakes http://localhost:3000 as the API address: send those calls to this run's API, and record each beacon with the collector's answer.
const API = process.env.API;
await ctx.route('http://localhost:3000/**', async (route) => {
  const req = route.request();
  const res = await route.fetch({ url: req.url().replace('http://localhost:3000', API) }).catch(() => null);
  if (/\/telemetry\/collect/.test(req.url()) && req.method() === 'POST') {
    let body; try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; }
    // A plain array (events), one event, or the collector's envelope ({ batchId, events }).
    for (const ev of Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body]) if (ev?.event_name) beacons.push({ event: ev, status: res?.status() ?? 0 });
  }
  if (res) await route.fulfill({ response: res }); else await route.abort();
});
const of = (name) => beacons.filter((b) => b.event.event_name === name);
const settle = () => page.waitForTimeout(1500);
try {
  // ---- search ----
  await page.goto('/shop?search=Power%20Bank'); await settle();
  check('webdriver flag is off (events are not dropped as automation)', (await page.evaluate(() => navigator.webdriver)) !== true);
  check('a search sends ONE search event with its term', of('search').length === 1 && of('search')[0].event.search_term === 'power bank', JSON.stringify(of('search').map((b) => b.event.search_term)));
  check('the collector accepts it', [200, 202, 207].includes(of('search')[0]?.status), String(of('search')[0]?.status));
  await page.goto('/shop?search=Power%20Bank&page=2'); await settle();
  await page.reload(); await settle();
  check('paging and reloading the same results is not a second search', of('search').length === 1, String(of('search').length));
  await page.goto('/shop?q=cable'); await settle();
  check('a new term is a new search', of('search').length === 2 && of('search')[1].event.search_term === 'cable');
  await page.goto('/shop'); await settle();
  check('the shop without a term is not a search', of('search').length === 2);

  // ---- new account ----
  const stamp = Date.now().toString().slice(-7);
  await page.goto('/register');
  await page.fill('#email', `signal-check-${stamp}@goldplus.test`);
  await page.fill('#phone', `0772${stamp.slice(0, 6)}`);
  await page.fill('#password', 'Signal-Check-1'); await page.fill('#confirmPassword', 'Signal-Check-1');
  await Promise.all([page.waitForNavigation(), page.locator('form:has(#confirmPassword) button[type=submit], form:has(#confirmPassword) button:not([type])').first().click()]);
  await settle();
  const registered = !/\/register/.test(new URL(page.url()).pathname);
  check('registration succeeded and moved on', registered, page.url() + ' :: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300));
  check('a new account sends ONE sign_up, accepted by the collector', of('sign_up').length === 1 && [200, 202, 207].includes(of('sign_up')[0].status), JSON.stringify(of('sign_up').map((b) => b.status)));
  check('the marker cookie is cleared after it is read', !(await ctx.cookies()).some((c) => c.name === 'gp_signed_up'));
  await page.goto('/account'); await settle();
  check('the next page does not report the account again', of('sign_up').length === 1);

  // ---- directions ----
  await page.goto('/support'); await settle();
  let link = page.locator('a[href*="maps"]').first();
  if (await link.count() === 0) {
    // The local database has no map link saved: put the shop's kind of link on the page.
    await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://maps.app.goo.gl/example'; a.textContent = 'Open the map'; a.id = 'gp-map'; a.target = '_blank'; document.body.prepend(a); });
    link = page.locator('#gp-map');
  }
  await page.route(/google\.|goo\.gl/, (r) => r.abort());
  ctx.on('page', (p) => p.close().catch(() => undefined));
  await link.click({ noWaitAfter: true }).catch(() => undefined); await settle();
  await link.click({ noWaitAfter: true }).catch(() => undefined); await settle();
  check('a tap on the map link sends ONE find_location per page view, accepted', of('find_location').length === 1 && [200, 202, 207].includes(of('find_location')[0].status), JSON.stringify(of('find_location').map((b) => b.status)));
  await page.locator('a[href^="/"]').first().click({ noWaitAfter: true, trial: true }).catch(() => undefined);
  // ---- WhatsApp: the advert landing page, and a link on an ordinary page ----
  await page.route(/wa\.me|api\.whatsapp\.com/, (r) => r.abort());
  await page.goto('/wa?fbclid=IwAR_browser_check_click'); await settle();
  const bridge = page.locator('a[data-wa-bridge]');
  check('/wa shows one WhatsApp button and does not leave by itself', (await bridge.count()) === 1 && new URL(page.url()).pathname === '/wa', page.url());
  check('/wa is not for search engines', (await page.locator('meta[name="robots"]').getAttribute('content') ?? '').includes('noindex'));
  await bridge.click({ noWaitAfter: true }).catch(() => undefined); await settle();
  const tagged = await bridge.getAttribute('href');
  const code = (/Ref%20(GP-[23456789A-Z]{6})/.exec(tagged ?? '') ?? [])[1];
  check('the tap puts a reference code in the chat message', !!code, String(tagged).slice(0, 160));
  check('the code is filed with the collector against this visitor', of('whatsapp_ref').some((b) => b.event.ref?.code === code && /^fp\./.test(b.event.user_data?.fp_client_id ?? '') && [200, 202, 207].includes(b.status)), JSON.stringify(of('whatsapp_ref').map((b) => [b.event.ref?.code, b.status])));
  check('the tap is ONE contact, on the landing page', of('generate_lead').length === 1 && of('generate_lead')[0].event.lead?.method === 'whatsapp' && /\/wa\?/.test(of('generate_lead')[0].event.page_location), JSON.stringify(of('generate_lead').map((b) => b.event.page_location)));
  check('the advert click was kept for this visitor (Meta click id built from fbclid)', await page.evaluate(() => { try { return /fb\.1\.\d+\.IwAR_browser_check_click/.test(localStorage.getItem('_gp_ad_click') ?? ''); } catch { return false; } }));
  await page.goto('/support'); await settle();
  const anyWa = page.locator('a[href^="https://wa.me/"]').first();
  if (await anyWa.count()) {
    await anyWa.click({ noWaitAfter: true, force: true }).catch(() => undefined); await settle();
    check('a WhatsApp link on an ordinary page is tagged and counted too', of('generate_lead').length === 2 && of('whatsapp_ref').length === 2, `${of('generate_lead').length} leads, ${of('whatsapp_ref').length} refs`);
  }
  check('every signal names its page and its visitor, and no contact detail', beacons.filter((b) => ['search', 'sign_up', 'find_location'].includes(b.event.event_name)).every((b) => /^http/.test(b.event.page_location) && /^fp\./.test(b.event.user_data?.fp_client_id ?? '') && !b.event.user_data?.hashed_email && !b.event.user_data?.hashed_phone));
  check('no page error', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('script ran to the end', false, e.message); }
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
