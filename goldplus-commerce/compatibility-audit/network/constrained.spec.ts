import { test, expect, expectRenderedPage, webVitalsSnapshot, openMobileMenu } from '../helpers/fixtures';
import { applyProfile, NETWORK_PROFILES } from '../helpers/profiles.mjs';

/**
 * Constrained network + CPU (Chromium/CDP only → EMULATED_CONSTRAINED_DEVICE /
 * EMULATED_NETWORK). Firefox and WebKit cannot be throttled through Playwright;
 * their cells stay ENGINE_CONTROL and the matrix says so. Interruption tests use
 * context.setOffline() during SAFE actions only (search, product view, cart page).
 */
test.describe('constrained profiles', () => {
  test.skip(() => test.info().project.metadata?.engine !== 'chromium', 'CDP throttling is Chromium-only');
  test.skip(() => !/small_low_end_android|mainstream_android/.test(test.info().project.name), 'mobile Chromium classes only');

  for (const network of ['slow_mobile', 'high_latency', 'severe_constrained'] as const) {
    test(`home → product → add to cart under ${network} with the project's CPU profile`, async ({ page, gp }) => {
      test.setTimeout(300_000);
      await applyProfile(page, { network, cpu: gp.cpu ?? 'reference' });
      const t0 = Date.now();
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const home = await webVitalsSnapshot(page);
      await expectRenderedPage(page);
      const url = await gp.resolveProduct(page);
      const t1 = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const product = await webVitalsSnapshot(page);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const add = page.getByRole('button', { name: /Add to cart/i }).first();
      let addMs: number | null = null;
      if (await add.isVisible().catch(() => false)) { const t2 = Date.now(); await add.click(); await page.waitForURL(/\/cart/); addMs = Date.now() - t2; }
      gp.report('constrained', { network, cpu: gp.cpu ?? 'reference', profile: NETWORK_PROFILES[network], home, product, product_nav_ms: Date.now() - t1, add_to_cart_ms: addMs, total_ms: Date.now() - t0, status: 'PASS' });
      expect(home.fcp_ms ?? 0, 'home painted').toBeGreaterThan(0);
    });
  }

  test('search under high latency: typing fast, out-of-order responses, then a dropped connection', async ({ page, gp }) => {
    test.setTimeout(180_000);
    const profile = await applyProfile(page, { network: 'high_latency', cpu: gp.cpu ?? 'reference' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openMobileMenu(page);
    const box = page.getByRole('searchbox', { name: 'Search products' }).filter({ visible: true }).first();
    // "charge" has results online; the last keystroke completes "charger", which also has results, so an
    // honest offline state can only be "couldn't load" — never "no match".
    await box.pressSequentially('char', { delay: 40 });
    await box.pressSequentially('ge', { delay: 40 });
    const sheet = page.getByRole('listbox', { name: 'Search suggestions' }).filter({ visible: true }).first();
    const shown = await sheet.isVisible({ timeout: 10000 }).catch(() => false);
    await page.waitForTimeout(2500);
    const textOnline = shown ? (await sheet.innerText()).slice(0, 200) : '';
    let failedRequest = false; page.on('requestfailed', (r) => { if (/suggest/.test(r.url())) failedRequest = true; });
    await profile.setOffline(true);
    await box.pressSequentially('r', { delay: 40 });
    await page.waitForTimeout(2000);
    const textOffline = shown ? (await sheet.innerText().catch(() => '')).slice(0, 200) : '';
    await profile.setOffline(false);
    const claimsNoMatchWhileOffline = failedRequest && /no match|no results/i.test(textOffline) && !/couldn.t|offline|connection|try again|unavailable/i.test(textOffline);
    const inconclusive = !failedRequest;
    // The form submit is the contract: it must still reach the results page once online.
    await box.press('Enter');
    await page.waitForURL(/\/shop\?/, { timeout: 60000 });
    await expectRenderedPage(page);
    gp.report('search_constraint', { suggestions_shown_online: shown, sheet_online: textOnline, sheet_offline: textOffline, suggest_request_failed_offline: failedRequest, network_failure_masquerades_as_empty: claimsNoMatchWhileOffline, status: inconclusive ? 'INCONCLUSIVE' : claimsNoMatchWhileOffline ? 'FINDING' : 'PASS', severity: claimsNoMatchWhileOffline ? 'P2' : null, note: claimsNoMatchWhileOffline ? 'A dropped connection during suggestion fetch is rendered as "No match" (GpNav.astro catch → renderHits(q, [])). The shopper reads an empty catalogue instead of a connection problem.' : null });
  });

  test('offline → online during safe actions: product page, cart page, then recovery without duplicate actions', async ({ page, gp }) => {
    test.setTimeout(180_000);
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    const canBuy = await add.isVisible().catch(() => false);
    if (canBuy) { await add.click(); await page.waitForURL(/\/cart/); }
    const linesBefore = canBuy ? await page.getByRole('button', { name: /^Remove .* from cart$/ }).count() : 0;
    await page.context().setOffline(true);
    // /cart is a sensitive route the service worker bypasses: offline it must fail visibly, never show a stale cart as current.
    let offlineOutcome = 'navigation_error';
    let offlineText = '';
    try { await page.goto('/cart', { waitUntil: 'domcontentloaded', timeout: 20000 }); offlineText = (await page.locator('body').innerText().catch(() => '')).slice(0, 200); offlineOutcome = /offline|connection/i.test(offlineText) ? 'offline_page' : (offlineText.trim() ? 'rendered_something' : 'blank'); }
    catch { offlineOutcome = 'navigation_error'; }
    // /shop is precached by the service worker: offline it may serve the precached snapshot or the offline page — never blank.
    let shopOffline = 'navigation_error'; let shopText = '';
    try { await page.goto('/shop', { waitUntil: 'domcontentloaded', timeout: 20000 }); shopText = (await page.locator('body').innerText().catch(() => '')).slice(0, 200); shopOffline = shopText.trim().length > 40 ? (/offline|connection/i.test(shopText) ? 'offline_page' : 'precached_snapshot') : 'blank'; }
    catch { shopOffline = 'navigation_error'; }
    await page.context().setOffline(false);
    await page.goto('/cart', { waitUntil: 'domcontentloaded' });
    const linesAfter = await page.getByRole('button', { name: /^Remove .* from cart$/ }).count();
    gp.report('interruption', { cart_offline: offlineOutcome, cart_offline_text: offlineText.slice(0, 120), shop_offline: shopOffline, shop_offline_text: shopText.slice(0, 120), lines_before: linesBefore, lines_after_recovery: linesAfter, status: linesAfter === linesBefore && offlineOutcome !== 'blank' && shopOffline !== 'blank' ? 'PASS' : 'FINDING' });
    expect(linesAfter, 'no duplicate or lost cart lines after reconnecting').toBe(linesBefore);
    expect(shopOffline, 'no blank screen offline').not.toBe('blank');
  });

  test('storage loss: localStorage, Cache Storage and the service worker cleared mid-session — shopping continues', async ({ page, gp }) => {
    test.setTimeout(180_000);
    const url = await gp.resolveProduct(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const cleared = await page.evaluate(async () => {
      const out: Record<string, unknown> = {};
      try { localStorage.clear(); sessionStorage.clear(); out.local = 'cleared'; } catch (e) { out.local = String(e); }
      try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); out.caches = keys; } catch (e) { out.caches = String(e); }
      try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); out.sw_unregistered = regs.length; } catch (e) { out.sw = String(e); }
      return out;
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (await add.isVisible().catch(() => false)) { await add.click(); await page.waitForURL(/\/cart/); await expect(page.getByRole('list', { name: 'Cart items' })).toBeVisible(); }
    gp.report('storage_loss', { cleared, status: 'PASS' });
  });
});
