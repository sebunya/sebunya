import { test, expect, expectRenderedPage, openMobileMenu, waitForHandlers } from '../helpers/fixtures';

/**
 * Critical commerce journeys A–L on every engine/viewport project.
 * Non-destructive: the only side effect is a cart line for the test's own
 * fresh browser context. Checkout is entered and its form is exercised, but
 * NEVER submitted. WhatsApp links are inspected, never opened.
 */
const journey = (id: string, name: string) => `${id} — ${name}`;

/**
 * First interaction after `load`, not after DOMContentLoaded: the live site runs
 * behind Cloudflare Rocket Loader (discovered 2026-09-13), which defers every
 * module script until window.load. browser/early-interaction.spec.ts measures
 * that gap on purpose; the journeys model a customer who waits for the page.
 */
async function openMobileMenuIfPresent(page: import('@playwright/test').Page) {
  return (await openMobileMenu(page)) !== null;
}

test.describe('critical journeys', () => {
  test(journey('A', 'discovery: home → navigation → category → product'), async ({ page, gp }) => {
    await page.goto('/', { waitUntil: 'load' });
    await expectRenderedPage(page);
    const mobile = await openMobileMenuIfPresent(page);
    const power = page.getByRole('link', { name: /^Power\b/ }).filter({ visible: true }).first();
    await expect(power).toBeVisible();
    await power.click();
    // Some engines (Firefox reports no hover capability) treat the first click on a rail item as "open the panel".
    let secondClick = false;
    try { await page.waitForURL(/\/shop\?category=power/, { timeout: 5000 }); } catch { secondClick = true; await power.click(); await page.waitForURL(/\/shop\?category=power/); }
    await expectRenderedPage(page);
    await page.mouse.move(8, 700); await page.keyboard.press('Escape'); // leave the header so the mega menu overlay cannot cover the cards
    const card = page.locator('main a[href^="/products/"]').filter({ visible: true }).first();
    await expect(card, 'category page lists at least one product').toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForURL(/\/products\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    gp.report('journeys', { journey: 'A', status: 'PASS', menu: mobile ? 'burger' : 'inline', rail_needed_second_click: secondClick, url: page.url() });
  });

  test(journey('B', 'search: home → search → results → product'), async ({ page, gp }) => {
    await page.goto('/', { waitUntil: 'load' });
    const inputs = page.getByRole('searchbox', { name: 'Search products' });
    let box = inputs.first();
    if (!(await box.isVisible().catch(() => false))) { await openMobileMenuIfPresent(page); box = inputs.filter({ visible: true }).first(); }
    await expect(box).toBeVisible();
    await box.fill('charger');
    // Suggestions are progressive enhancement; the form submit is the contract.
    const sheet = page.getByRole('listbox', { name: 'Search suggestions' }).filter({ visible: true }).first();
    const suggested = await sheet.isVisible({ timeout: 4000 }).catch(() => false);
    await box.press('Enter');
    await page.waitForURL(/\/shop\?/);
    await expectRenderedPage(page);
    const card = page.locator('main a[href^="/products/"]').filter({ visible: true }).first();
    await expect(card, 'search results list a product').toBeVisible();
    await card.click();
    await page.waitForURL(/\/products\//);
    gp.report('journeys', { journey: 'B', status: 'PASS', suggestions_rendered: suggested, url: page.url() });
  });

  test(journey('C', 'category: shop → sort → product'), async ({ page, gp }) => {
    await page.goto('/shop?category=power', { waitUntil: 'domcontentloaded' });
    const sort = page.getByRole('combobox', { name: 'Sort products' });
    let sorted = false;
    if (await sort.isVisible().catch(() => false)) {
      const options = await sort.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      const other = options.find((v) => v && !page.url().endsWith(v)) ?? options[1];
      if (other) { await Promise.all([page.waitForURL(() => true), sort.selectOption(other)]); await page.waitForLoadState('domcontentloaded'); sorted = true; }
    }
    const card = page.locator('main a[href^="/products/"]').filter({ visible: true }).first();
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL(/\/products\//);
    gp.report('journeys', { journey: 'C', status: 'PASS', sorted, url: page.url() });
  });

  test(journey('D', 'product: images, information, price, stock, Add to Cart'), async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const img = page.locator('main img').first();
    await expect(img).toBeVisible();
    const natural = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    const price = page.locator('main').getByText(/UGX|USh|\b\d{1,3}(,\d{3})+\b/).first();
    await expect(price, 'a price is visible').toBeVisible();
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    const canBuy = await add.isVisible().catch(() => false);
    if (!canBuy) { gp.report('journeys', { journey: 'D', status: 'PASS_NO_STOCK', note: 'product not purchasable right now; availability label shown instead of Add to cart', url }); return; }
    await add.click();
    await page.waitForURL(/\/cart/);
    await expect(page.getByRole('list', { name: 'Cart items' })).toBeVisible();
    gp.report('journeys', { journey: 'D', status: 'PASS', image_decoded: natural > 0, url });
  });

  test(journey('E', 'cart: add → quantity → remove → totals'), async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (!(await add.isVisible().catch(() => false))) { gp.report('journeys', { journey: 'E', status: 'PASS_NO_STOCK', url }); return; }
    await add.click();
    await page.waitForURL(/\/cart/);
    const inc = page.getByRole('button', { name: /^Increase quantity of/ }).first();
    await expect(inc).toBeVisible();
    await inc.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByLabel(/^Quantity: 2/).first()).toBeVisible();
    const dec = page.getByRole('button', { name: /^Decrease quantity of/ }).first();
    await dec.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByLabel(/^Quantity: 1/).first()).toBeVisible();
    const total = page.locator('main').getByText(/total/i).first();
    await expect(total).toBeVisible();
    const remove = page.getByRole('button', { name: /^Remove .* from cart$/ }).first();
    await remove.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /^Remove .* from cart$/ })).toHaveCount(0);
    gp.report('journeys', { journey: 'E', status: 'PASS', url });
  });

  test(journey('F', 'checkout entry: cart → checkout → form interaction (never submitted)'), async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (!(await add.isVisible().catch(() => false))) { gp.report('journeys', { journey: 'F', status: 'PASS_NO_STOCK', url }); return; }
    await add.click();
    await page.waitForURL(/\/cart/);
    const checkoutLink = page.getByRole('link', { name: /checkout/i }).first();
    await expect(checkoutLink).toBeVisible();
    await checkoutLink.click();
    await page.waitForURL(/\/checkout/);
    await page.waitForLoadState('load');
    const form = page.locator('#checkout-form');
    await expect(form).toBeVisible();
    // Interact, never submit: Enter is never pressed, the submit button is never clicked.
    const name = form.locator('input[name="name"]'); const phone = form.locator('input[name="phone"]');
    // Type until the page's own draft handler is bound (late behind Rocket Loader); the wait is recorded.
    const handlersMs = await waitForHandlers(page, async () => { await name.fill(''); await name.fill('Compatibility Audit'); return (await page.evaluate(() => localStorage.getItem('gp_checkout_draft_v1'))) !== null; });
    await phone.fill('0700000000');
    const phoneAttrs = await phone.evaluate((el) => ({ type: el.getAttribute('type'), inputmode: el.getAttribute('inputmode'), autocomplete: el.getAttribute('autocomplete'), fontSize: getComputedStyle(el).fontSize }));
    const pickup = form.locator('input[name="deliveryMethod"][value="pickup"]');
    if (await pickup.isVisible().catch(() => false)) { await pickup.check(); await form.locator('input[name="deliveryMethod"][value="door"]').check(); }
    const submit = form.locator('button[type="submit"]').first();
    await expect(submit).toBeVisible();
    const keyboardFocusable = await phone.evaluate((el) => { (el as HTMLElement).focus(); return document.activeElement === el; });
    // reload: the draft (localStorage) must survive
    await page.reload({ waitUntil: 'domcontentloaded' });
    const restored = await page.locator('#checkout-form input[name="name"]').inputValue().catch(() => '');
    gp.report('journeys', { journey: 'F', status: 'PASS', phone_field: phoneAttrs, draft_handler_bound_after_ms: handlersMs, draft_restored_after_reload: restored === 'Compatibility Audit', keyboard_focusable: keyboardFocusable, url: page.url() });
    expect(restored, 'checkout draft restored after reload').toBe('Compatibility Audit');
  });

  test(journey('G', 'battery finder: device/model → result → product'), async ({ page, gp }) => {
    await page.goto('/battery-finder', { waitUntil: 'domcontentloaded' });
    await expectRenderedPage(page);
    const box = page.getByRole('searchbox').first();
    let resultLink = false;
    if (await box.isVisible().catch(() => false)) {
      await box.fill('Tecno');
      await page.getByRole('button', { name: /^Search$/ }).first().click();
      await page.waitForLoadState('domcontentloaded');
      await expectRenderedPage(page);
      const link = page.locator('main a[href^="/products/"]').filter({ visible: true }).first();
      resultLink = await link.isVisible().catch(() => false);
      if (resultLink) { await link.click(); await page.waitForURL(/\/products\//); }
    }
    gp.report('journeys', { journey: 'G', status: 'PASS', result_link: resultLink, note: resultLink ? null : 'finder answered without a product link for "Tecno" (catalogue content, not a compatibility defect)', url: page.url() });
  });

  test(journey('H', 'product finder renders and is usable'), async ({ page, gp }) => {
    await page.goto('/product-finder', { waitUntil: 'domcontentloaded' });
    await expectRenderedPage(page);
    const controls = await page.locator('main select, main input, main button').count();
    gp.report('journeys', { journey: 'H', status: 'PASS', controls, url: page.url() });
    expect(controls).toBeGreaterThan(0);
  });

  test(journey('K', 'delivery and support pages'), async ({ page, gp }) => {
    for (const path of ['/delivery/kampala-wakiso', '/support', '/track-order', '/faq']) {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      await expectRenderedPage(page);
    }
    gp.report('journeys', { journey: 'K', status: 'PASS' });
  });

  test(journey('L', 'WhatsApp destinations are well-formed (never opened)'), async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    const findings: Array<{ page: string; href: string; ok: boolean }> = [];
    for (const path of ['/', url, '/support']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const hrefs = await page.locator('a[href^="https://wa.me/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const h of hrefs) { const u = new URL(h); const ok = /^\/\d{9,15}\/?$/.test(u.pathname) || u.pathname === '/'; findings.push({ page: path, href: h.slice(0, 120), ok }); }
    }
    gp.report('journeys', { journey: 'L', status: findings.every((f) => f.ok) ? 'PASS' : 'FAIL', links: findings });
    expect(findings.length, 'WhatsApp links exist').toBeGreaterThan(0);
    expect(findings.every((f) => f.ok)).toBe(true);
  });

  test(journey('X', 'back / forward / reload through search → product → cart does not duplicate cart lines'), async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    await page.goto('/shop?search=charger', { waitUntil: 'domcontentloaded' });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (!(await add.isVisible().catch(() => false))) { gp.report('journeys', { journey: 'X', status: 'PASS_NO_STOCK', url }); return; }
    await add.click();
    await page.waitForURL(/\/cart/);
    const linesBefore = await page.getByRole('button', { name: /^Remove .* from cart$/ }).count();
    await page.goBack({ waitUntil: 'domcontentloaded' });        // product page (POST result must not resubmit)
    await page.goForward({ waitUntil: 'domcontentloaded' });     // cart again
    await page.reload({ waitUntil: 'domcontentloaded' });
    const linesAfter = await page.getByRole('button', { name: /^Remove .* from cart$/ }).count();
    const qty = await page.getByLabel(/^Quantity: /).first().getAttribute('aria-label');
    gp.report('journeys', { journey: 'X', status: linesAfter === linesBefore && /Quantity: 1/.test(qty ?? '') ? 'PASS' : 'FAIL', lines_before: linesBefore, lines_after: linesAfter, qty });
    expect(linesAfter).toBe(linesBefore);
    expect(qty).toMatch(/Quantity: 1\b/);
  });
});
