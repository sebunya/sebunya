import { test, expect } from '../helpers/fixtures';

/**
 * Customer data consumption per core journey, cold (fresh context, empty
 * cache) and warm (same context, HTTP cache and service worker active), by
 * resource class and first vs third party. Reported in bytes; the report
 * renders KB/MB. Measured on the mainstream Android Chromium class so the
 * numbers are comparable run-to-run.
 */
test.describe('data usage', () => {
  test.skip(() => !/mainstream_android/.test(test.info().project.name), 'one comparable class');

  test('homepage cold and warm', async ({ page, gp }) => {
    await page.goto('/', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    const cold = gp.usage.total(); gp.usage.reset();
    await page.goto('/', { waitUntil: 'load' }); await page.waitForTimeout(1000);
    const warm = gp.usage.total();
    gp.report('data_usage', { journey: 'home', cold, warm });
    expect(cold.total_bytes).toBeGreaterThan(0);
  });

  test('home → product', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page); gp.usage.reset();
    await page.goto('/', { waitUntil: 'load' }); await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1000);
    const cold = gp.usage.total(); gp.usage.reset();
    await page.goto('/', { waitUntil: 'load' }); await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(800);
    gp.report('data_usage', { journey: 'home_to_product', cold, warm: gp.usage.total() });
  });

  test('search → product', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page); gp.usage.reset();
    await page.goto('/shop?search=charger', { waitUntil: 'load' }); await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1000);
    const cold = gp.usage.total(); gp.usage.reset();
    await page.goto('/shop?search=charger', { waitUntil: 'load' }); await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(800);
    gp.report('data_usage', { journey: 'search_to_product', cold, warm: gp.usage.total() });
  });

  test('category → product', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page); gp.usage.reset();
    await page.goto('/shop?category=power', { waitUntil: 'load' }); await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1000);
    const cold = gp.usage.total(); gp.usage.reset();
    await page.goto('/shop?category=power', { waitUntil: 'load' }); await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(800);
    gp.report('data_usage', { journey: 'category_to_product', cold, warm: gp.usage.total() });
  });

  test('product → cart → checkout', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'load' });
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (!(await add.isVisible().catch(() => false))) { gp.report('data_usage', { journey: 'product_to_checkout', skipped: 'product not purchasable' }); return; }
    gp.usage.reset();
    await add.click(); await page.waitForURL(/\/cart/); await page.waitForLoadState('load'); await page.waitForTimeout(800);
    const toCart = gp.usage.total(); gp.usage.reset();
    await page.getByRole('link', { name: /checkout/i }).first().click(); await page.waitForURL(/\/checkout/); await page.waitForLoadState('load'); await page.waitForTimeout(800);
    const toCheckout = gp.usage.total();
    gp.report('data_usage', { journey: 'product_to_cart', cold: toCart, warm: null });
    gp.report('data_usage', { journey: 'cart_to_checkout', cold: toCheckout, warm: null });
  });
});
