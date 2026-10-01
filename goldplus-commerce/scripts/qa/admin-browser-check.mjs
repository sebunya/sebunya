// Driven by scripts/qa/admin-browser-check.sh (see there). Real Chromium, real form posts.
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('@playwright/test');
const WEB = process.env.WEB; const EMAIL = 'browser-check@goldplus.test';
const OLD = 'Initial-Password-1'; const NEW = 'Changed-Password-2';
let failed = 0; const errors = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); if (!ok) failed += 1; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: WEB });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|cloudflareinsights/.test(m.text())) errors.push(`${page.url()} :: console: ${m.text().slice(0, 200)}`); });
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const signIn = async (path, password) => {
  await page.goto(path);
  await page.fill('#email', EMAIL); await page.fill('#password', password);
  await Promise.all([page.waitForNavigation(), page.locator('form:has(#password) button[type=submit], form:has(#password) button:not([type])').first().click()]);
};
try {
  // ---- X (Twitter) card tags on a public page ----
  await page.goto('/');
  const meta = (sel) => page.locator(sel).first().getAttribute('content').catch(() => null);
  check('X card: twitter:* are name tags, with the site handle', (await meta('meta[name="twitter:card"]')) === 'summary_large_image' && (await meta('meta[name="twitter:site"]')) === '@shopgoldplus' && (await page.locator('meta[property^="twitter:"]').count()) === 0, `card=${await meta('meta[name="twitter:card"]')} site=${await meta('meta[name="twitter:site"]')}`);
  const cardImage = await meta('meta[name="twitter:image"]');
  check('X card: an absolute image with alt text, a title and a description', /^https?:\/\//.test(cardImage ?? '') && !!(await meta('meta[name="twitter:image:alt"]')) && !!(await meta('meta[name="twitter:title"]')) && !!(await meta('meta[name="twitter:description"]')), String(cardImage));
  check('the footer links to the same X account', (await page.locator('a[href="https://x.com/shopgoldplus"]').count()) > 0);

  // ---- change password (customer account area) ----
  await signIn('/login', OLD);
  let r = await page.goto('/account/password');
  check('password page loads signed in', r.status() === 200 && /Change password/.test(await text()), `${r.status()} ${page.url()}`);
  check('account nav has a Password entry marked current', (await page.locator('nav[aria-label="Account sections"] a[aria-current="page"]').innerText()).trim().toLowerCase() === 'password');
  const submit = async (cur, nw, conf) => {
    await page.fill('#currentPassword', cur); await page.fill('#newPassword', nw); await page.fill('#confirmPassword', conf);
    await Promise.all([page.waitForNavigation(), page.locator('form:has(#currentPassword) button[type=submit]').click()]);
  };
  await submit(OLD, NEW, 'Different-Password-3');
  check('mismatched confirmation is refused', /do not match/.test(await text()), (await text()).slice(0, 200));
  await submit('wrong-current-pw', NEW, NEW);
  check('wrong current password is refused', /current password is not correct/.test(await text()), (await text()).slice(0, 300));
  await submit(OLD, OLD, OLD);
  check('unchanged password is refused', /must be different/.test(await text()), (await text()).slice(0, 300));
  await submit(OLD, NEW, NEW);
  check('success lands on sign-in with the confirmation', /\/login\?passwordChanged=1/.test(page.url()) && /signed out everywhere/.test(await text()), `${page.url()} ${(await text()).slice(0, 200)}`);
  // Token issue times are whole seconds and the session cutoff is not, so a
  // token minted in the same second as the cutoff is treated as issued before
  // it. A person types for longer than that; a script must wait it out.
  await page.waitForTimeout(1500);
  await page.goto('/account/password');
  check('this device was signed out', /\/login/.test(page.url()), page.url());
  await signIn('/login', OLD);
  check('old password no longer signs in', !/\/account/.test(page.url()) && /do not match/i.test(await text()), page.url());
  await signIn('/login', NEW);
  await page.goto('/account/password');
  check('new password signs in', /\/account\/password/.test(page.url()), page.url());

  // ---- admin pages ----
  await signIn('/admin/login', NEW);
  check('admin sign-in with the new password', /\/admin/.test(page.url()) && !/\/admin\/login/.test(page.url()), page.url());

  r = await page.goto('/admin/consent-operating');
  check('consent page loads', r.status() === 200, String(r.status()));
  const options = await page.locator('select[name=channel] option').allInnerTexts();
  check('STOP form offers WhatsApp, SMS and Email', options.join(',') === 'WhatsApp,SMS,Email', options.join(','));
  check('time field is labelled Kampala time', /Kampala time/.test(await text()));
  const stop = async (channel, contact) => {
    await page.selectOption('select[name=channel]', channel);
    await page.fill('input[name=contact]', contact);
    await page.fill('input[name=provider_event_ref]', `ref-${Date.now()}`);
    await page.fill('input[name=provider_occurred_at]', '2026-09-30T10:15');
    await page.fill('textarea[name=evidence]', 'Customer replied STOP; seen in provider console.');
    await page.check('input[name=authenticity_verified]'); await page.check('input[name=freshness_verified]');
    await Promise.all([page.waitForNavigation(), page.click('button:has-text("Record suppression")')]);
  };
  await stop('sms', '0772 123456');
  check('an SMS STOP is recorded', /Suppression recorded/.test(await text()), (await text()).match(/Not recorded[^.]*\.[^.]*\./)?.[0] ?? (await text()).slice(0, 300));
  let rows = page.locator('[data-testid=suppression-list] tbody tr');
  check('the suppression is listed, masked, with a Lift form', (await rows.count()) === 1 && /phone:\+256•••••456/.test(await rows.first().innerText()) && (await rows.first().locator('[data-testid=suppression-lift-form]').count()) === 1, await rows.first().innerText().catch(() => 'no row'));
  check('the full number is not on the page', !(await page.content()).includes('256772123456'));
  await stop('email', 'Person@Example.com');
  check('an email unsubscribe is recorded', /Suppression recorded/.test(await text()) && (await page.locator('[data-testid=suppression-list] tbody tr').count()) === 2);
  // lift: short reason refused by the server-side helper (bypass the browser's own minlength)
  const smsRow = page.locator('[data-testid=suppression-list] tbody tr', { hasText: 'sms' });
  await smsRow.locator('input[name=lift_reason]').evaluate((el) => { el.removeAttribute('minlength'); el.removeAttribute('required'); });
  await smsRow.locator('input[name=lift_reason]').fill('no');
  await Promise.all([page.waitForNavigation(), smsRow.locator('button:has-text("Lift")').click()]);
  check('a lift without a real reason is refused', /Give a reason of 5 to 500/.test(await text()) && (await page.locator('[data-testid=suppression-list] tbody tr').count()) === 2, (await text()).slice(0, 200));
  const smsRow2 = page.locator('[data-testid=suppression-list] tbody tr', { hasText: 'sms' });
  await smsRow2.locator('input[name=lift_reason]').fill('recorded against the wrong contact');
  await Promise.all([page.waitForNavigation(), smsRow2.locator('button:has-text("Lift")').click()]);
  rows = page.locator('[data-testid=suppression-list] tbody tr');
  check('the lift succeeds and only the SMS row leaves the list', /Suppression lifted/.test(await text()) && (await rows.count()) === 1 && /email/.test(await rows.first().innerText()), (await text()).slice(0, 300));

  r = await page.goto('/admin/loyalty/tiers');
  check('tiers page loads', r.status() === 200, String(r.status()));
  const tierForm = page.locator('form:has(input[name=thresholdLifetimePoints])').first();
  if (await tierForm.count()) {
    const before = await tierForm.locator('input[name=thresholdLifetimePoints]').inputValue();
    await tierForm.locator('input[name=thresholdLifetimePoints]').fill('5k');
    await Promise.all([page.waitForNavigation(), tierForm.locator('button[type=submit], button:not([type])').first().click()]);
    const after = await page.locator('form:has(input[name=thresholdLifetimePoints])').first().locator('input[name=thresholdLifetimePoints]').inputValue();
    check('"5k" is refused and the stored threshold is untouched', /whole number of points/.test(await text()) && after === before, `before=${before} after=${after} ${(await text()).slice(0, 200)}`);
  } else { check('tiers exist to test the threshold form', false, (await text()).slice(0, 500)); }

  for (const path of ['/admin/measurement/dlq', '/admin/utm-builder', '/admin/payments', '/admin/verification', '/admin/measurement/channel-report', '/admin/loyalty/liability', '/admin/loyalty/adjustments', '/admin/campaigns', '/admin/inventory', '/admin/orders', '/admin/carts', '/admin/loyalty/referrals', '/admin/loyalty/fraud', '/admin/fulfilment', '/admin/delivery', '/admin/delivery/launch', '/admin/advertising', '/admin/advertising/activity', '/admin/advertising/activity?platform=meta&days=7']) {
    r = await page.goto(path); await page.waitForLoadState('networkidle').catch(() => {});
    check(`${path} renders`, r.status() === 200, String(r.status()));
  }
  await page.goto('/admin/loyalty/adjustments?userId=11111111-2222-4333-8444-555555555555');
  check('an unknown member id is reported, not shown as a zero balance', /No customer account has this id/.test(await text()), (await text()).slice(0, 300));
  const csvR = await page.evaluate(async () => { const r = await fetch('/api/admin/loyalty/finance-export.csv', { credentials: 'same-origin' }); return { status: r.status, type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), body: (await r.text()).slice(0, 200) }; });
  const csv = { status: () => csvR.status, headers: () => ({ 'content-type': csvR.type ?? '' }), text: async () => csvR.body + ' disp=' + csvR.disp };
  check('finance export answers as CSV for an admin', csv.status() === 200 && /text\/csv/.test(csv.headers()['content-type'] ?? ''), `${csv.status()} ${csv.headers()['content-type']} ${(await csv.text()).slice(0, 200)}`);
  check('no browser errors on any page', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) { check('run completed', false, String(e).slice(0, 400)); }
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
