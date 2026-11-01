// Driven by scripts/qa/tiktok-connect-check.sh (see there). Real Chromium, real form posts; TikTok is never contacted.
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('@playwright/test');
const WEB = process.env.WEB; const EMAIL = 'browser-check@goldplus.test'; const PASSWORD = 'Initial-Password-1';
const APP_ID = '7412345678901234567'; const CODE = 'authcode_0123456789abcdefXYZ';
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); if (!ok) failed += 1; };
// TikTok's hosts resolve to nowhere in this browser: whatever the pages do, TikTok is not contacted.
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.tiktok.com 127.0.0.1:9, MAP tiktok.com 127.0.0.1:9'] });
const ctx = await browser.newContext({ baseURL: WEB });
const page = await ctx.newPage();
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
// Anything the browser addresses to TikTok is recorded and stopped here (none is expected).
const toTikTok = [];
await ctx.route(/tiktok\.com/, (route) => { toTikTok.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>TikTok (stub)' }); });
try {
  // ---- signed out: both pages ask for a sign-in and keep where to return ----
  await page.goto(`/admin/advertising/tiktok/callback?auth_code=${CODE}&state=whatever-state-0123456789`);
  check('signed out, the callback asks for a sign-in', /\/admin\/login\?returnTo=/.test(page.url()), page.url());
  await page.goto('/login');
  await page.fill('#email', EMAIL); await page.fill('#password', PASSWORD);
  await Promise.all([page.waitForNavigation(), page.locator('form:has(#password) button[type=submit], form:has(#password) button:not([type])').first().click()]);

  // ---- the callback on its own does nothing ----
  let r = await page.goto('/admin/advertising/tiktok/callback');
  check('the callback with no code explains where to start', r.status() === 200 && /finishes an authorisation that starts on Connect TikTok/.test(await text()), `${r.status()} ${(await text()).slice(0, 200)}`);
  check('it shows no form', (await page.locator('input[name=appSecret]').count()) === 0);

  // ---- a reply that did not start in this browser is refused ----
  r = await page.goto(`/admin/advertising/tiktok/callback?auth_code=${CODE}&state=forged-state-0123456789abcdef`);
  check('a forged reply (no state in this browser) is refused, with no form', /did not start in this browser/.test(await text()) && (await page.locator('input[name=appSecret]').count()) === 0, (await text()).slice(0, 200));
  check('the refused code was not kept', !(await ctx.cookies()).some((c) => c.name === 'gp_tiktok_code'));

  // ---- start: the app ID is checked, saved, and the browser is sent to TikTok with a state ----
  r = await page.goto('/admin/advertising/tiktok/connect');
  check('the Connect page loads and names the redirect address', r.status() === 200 && /https:\/\/shopgoldplus\.com\/admin\/advertising\/tiktok\/callback/.test(await text()), `${r.status()}`);
  await page.locator('input[name=appId]').evaluate((el) => el.removeAttribute('pattern'));
  await page.fill('input[name=appId]', 'not-a-number');
  await Promise.all([page.waitForNavigation(), page.locator('form:has(input[name=appId]) button, form:has(input[name=appSecret]) button').click()]);
  check('a wrong app ID is refused and nothing is sent to TikTok', /App ID does not look right/.test(await text()) && toTikTok.length === 0, (await text()).slice(0, 200));
  await page.fill('input[name=appId]', APP_ID);
  const [started] = await Promise.all([
    page.waitForResponse((resp) => resp.request().method() === 'POST' && resp.url().endsWith('/admin/advertising/tiktok/connect')),
    page.locator('form:has(input[name=appId]) button').click(),
  ]);
  const location = started.headers()['location'] ?? '';
  const auth = started.status() === 303 && /^https:/.test(location) ? new URL(location) : null;
  if (!auth) console.log(`      start answered ${started.status()} location=${location}`);
  await page.waitForTimeout(500);
  const state = auth?.searchParams.get('state') ?? '';
  check('the browser is sent to TikTok\'s authorisation page', !!auth && auth.origin + auth.pathname === 'https://business-api.tiktok.com/portal/auth', `${started.status()} ${location}`);
  check('with the app ID, the registered redirect address and a long random state', auth?.searchParams.get('app_id') === APP_ID && auth?.searchParams.get('redirect_uri') === 'https://shopgoldplus.com/admin/advertising/tiktok/callback' && state.length >= 24, auth?.search ?? '');
  const stateCookie = (await ctx.cookies()).find((c) => c.name === 'gp_tiktok_state');
  check('the state is kept in an HttpOnly cookie scoped to these pages', !!stateCookie && stateCookie.httpOnly && stateCookie.path === '/admin/advertising/tiktok' && stateCookie.value === state, JSON.stringify(stateCookie ?? null));

  // ---- return with a different state: still refused ----
  await page.goto(`/admin/advertising/tiktok/callback?auth_code=${CODE}&state=${'x'.repeat(state.length)}`);
  check('a reply with a different state is refused', /did not start in this browser/.test(await text()));

  // ---- return with this browser's state: the code leaves the address bar ----
  r = await page.goto(`/admin/advertising/tiktok/callback?auth_code=${CODE}&state=${encodeURIComponent(state)}`);
  check('TikTok\'s reply with the right state is accepted and the code leaves the address bar', r.status() === 200 && !/auth_code|state=/.test(page.url()) && page.url().endsWith('/admin/advertising/tiktok/callback'), page.url());
  const html = await page.content();
  check('the page shows the form and does not contain the code', (await page.locator('input[name=appSecret][type=password]').count()) === 1 && !html.includes(CODE), html.includes(CODE) ? 'code in page' : 'no form');
  check('the app ID saved at the start is shown', new RegExp(APP_ID).test(await text()));
  const codeCookie = (await ctx.cookies()).find((c) => c.name === 'gp_tiktok_code');
  check('the code is kept in an HttpOnly cookie', !!codeCookie && codeCookie.httpOnly && codeCookie.value === CODE);
  check('the response is not cacheable and sends no referrer', r.headers()['cache-control'] === 'no-store' && r.headers()['referrer-policy'] === 'no-referrer', JSON.stringify([r.headers()['cache-control'], r.headers()['referrer-policy']]));

  // ---- the exchange: what is wrong is refused before any call to TikTok ----
  const before = toTikTok.length;
  await page.fill('input[name=appSecret]', 'short');
  await page.fill('input[name=advertiserId]', '7300000000000000001');
  await Promise.all([page.waitForNavigation(), page.locator('form:has(input[name=appId]) button, form:has(input[name=appSecret]) button').click()]);
  check('a secret that cannot be one is refused, and the form stays for another try', /App secret does not look right/.test(await text()) && (await page.locator('input[name=appSecret]').count()) === 1, (await text()).slice(0, 240));
  check('the secret is not echoed back into the page', !(await page.content()).includes('value="short"'));
  check('the address bar still holds no code', !/auth_code/.test(page.url()), page.url());
  check('nothing else was sent towards TikTok from the browser', toTikTok.length === before);

  // ---- the Advertising page links to it ----
  await page.goto('/admin/advertising');
  check('Advertising links to Connect TikTok', (await page.locator('a[href="/admin/advertising/tiktok/connect"]').count()) === 1);
} catch (err) {
  check('the run completed', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
