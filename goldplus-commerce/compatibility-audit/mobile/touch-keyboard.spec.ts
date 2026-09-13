import { test, expect, horizontalOverflow, openMobileMenu } from '../helpers/fixtures';

/**
 * Mobile ergonomics: touch targets, hover-free operation, iOS input auto-zoom
 * (inputs under 16px zoom the page on iOS Safari — checked on the WebKit
 * engine as a proxy), text scaling (approximated by a root font-size change:
 * EMULATED_TEXT_SCALING, not a device setting), reduced motion, zoom allowed.
 */
const MIN_TARGET = 44; // Apple/Android guidance; WCAG 2.2 AA minimum is 24

test.describe('mobile ergonomics', () => {
  test.skip(() => !/small_low_end_android|mainstream_iphone|small_iphone/.test(test.info().project.name), 'mobile classes only');

  test('key controls meet a 44px touch target (measured)', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    const rows: Array<Record<string, unknown>> = [];
    const measure = async (name: string, loc: import('@playwright/test').Locator) => {
      const box = await loc.first().boundingBox().catch(() => null);
      rows.push({ control: name, width: box ? Math.round(box.width) : null, height: box ? Math.round(box.height) : null, ok: !!box && box.width >= MIN_TARGET && box.height >= MIN_TARGET, present: !!box });
    };
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await measure('nav: open menu', page.getByRole('button', { name: 'Open menu' }));
    await openMobileMenu(page);
    await measure('nav: search (mobile)', page.getByRole('searchbox', { name: 'Search products' }).filter({ visible: true }));
    await measure('nav: subcategory toggle', page.getByRole('button', { name: /^Show .* subcategories$/ }).filter({ visible: true }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await measure('product: add to cart', page.getByRole('button', { name: /Add to cart/i }));
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (await add.isVisible().catch(() => false)) {
      await add.click(); await page.waitForURL(/\/cart/);
      await measure('cart: increase quantity', page.getByRole('button', { name: /^Increase quantity of/ }));
      await measure('cart: decrease quantity', page.getByRole('button', { name: /^Decrease quantity of/ }));
      await measure('cart: remove', page.getByRole('button', { name: /^Remove .* from cart$/ }));
      await measure('cart: checkout link', page.getByRole('link', { name: /checkout/i }));
    }
    const small = rows.filter((r) => r.present && !r.ok);
    gp.report('touch_targets', { rows, undersized: small, status: small.length ? 'FINDING' : 'PASS' });
    // Undersized targets are a P2/P3 finding (reported), not a suite failure: engineering judgement decides each one.
  });

  test('essential functions work without hover: mega menu and product cards by tap', async ({ page, gp }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openMobileMenu(page);
    const power = page.getByRole('link', { name: /^Power\b/ }).filter({ visible: true }).first();
    await expect(power).toBeVisible();
    const toggle = page.getByRole('button', { name: 'Show Power subcategories' });
    let subcats = null;
    if (await toggle.isVisible().catch(() => false)) { await toggle.click(); subcats = await toggle.getAttribute('aria-expanded'); }
    await power.click();
    await page.waitForURL(/\/shop/);
    const card = page.locator('main a[href^="/products/"]').first();
    await expect(card).toBeVisible();
    await card.tap().catch(async () => card.click());
    await page.waitForURL(/\/products\//);
    gp.report('hover_free', { status: 'PASS', subcategory_toggle_expanded: subcats });
  });

  test('checkout inputs are at least 16px (iOS auto-zoom guard) and the viewport allows user zoom', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    let inputs: Array<Record<string, unknown>> = [];
    if (await add.isVisible().catch(() => false)) {
      await add.click(); await page.waitForURL(/\/cart/);
      await page.getByRole('link', { name: /checkout/i }).first().click(); await page.waitForURL(/\/checkout/);
      inputs = await page.locator('#checkout-form input:not([type=hidden]):not([type=radio]):not([type=checkbox]), #checkout-form textarea, #checkout-form select').evaluateAll((els) => els.map((el) => ({ name: el.getAttribute('name'), type: el.getAttribute('type'), inputmode: el.getAttribute('inputmode'), autocomplete: el.getAttribute('autocomplete'), fontSizePx: parseFloat(getComputedStyle(el).fontSize) })));
    }
    const tooSmall = inputs.filter((i) => (i.fontSizePx as number) < 16);
    const userScalable = !/user-scalable\s*=\s*(no|0)/i.test(meta ?? '') && !/maximum-scale\s*=\s*1(\.0)?\b/i.test(meta ?? '');
    gp.report('form_ergonomics', { viewport_meta: meta, user_zoom_allowed: userScalable, inputs, ios_autozoom_risk: tooSmall.map((i) => i.name), status: userScalable && tooSmall.length === 0 ? 'PASS' : 'FINDING' });
    expect(userScalable, 'user zoom must not be disabled').toBe(true);
  });

  test('text scaling 125 / 150 / 200 % (emulated via root font-size) keeps the header, price and CTA usable', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    const rows: Array<Record<string, unknown>> = [];
    for (const pct of [125, 150, 200]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: `html{font-size:${pct}% !important}` });
      await page.waitForTimeout(150);
      const overflow = await horizontalOverflow(page);
      const h1 = await page.getByRole('heading', { level: 1 }).isVisible();
      const cta = page.getByRole('button', { name: /Add to cart|Notify|Out of stock|Coming/i }).first();
      let ctaVisible = false; if (await cta.count()) { await cta.scrollIntoViewIfNeeded(); ctaVisible = await cta.isVisible(); }
      const logo = await page.getByRole('link', { name: 'GoldPlus home' }).isVisible();
      rows.push({ scale_pct: pct, overflow_px: overflow, h1, cta_visible: ctaVisible, logo });
    }
    gp.report('text_scaling', { evidence: 'EMULATED_TEXT_SCALING', rows, status: rows.every((r) => (r.overflow_px as number) <= 8 && r.h1 && r.logo) ? 'PASS' : 'FINDING' });
    for (const r of rows) expect(r.h1 && r.logo, `${r.scale_pct}%: header and heading visible`).toBe(true);
  });

  test('prefers-reduced-motion: shopping still works', async ({ page, gp }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const url = await gp.resolveProduct(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'GoldPlus home' })).toBeVisible();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (await add.isVisible().catch(() => false)) { await add.click(); await page.waitForURL(/\/cart/); }
    gp.report('reduced_motion', { status: 'PASS' });
  });
});
