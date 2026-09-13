import { test, expect } from '../helpers/fixtures';

/**
 * Visual baselines for representative routes on one mobile Chromium, one
 * WebKit and one desktop class. Snapshots live under COMPAT_BASELINE_DIR
 * (the audit data directory, not Git). The first run creates them
 * (updateSnapshots: 'missing'); later runs diff at 2 % of pixels. The hero
 * carousel and rails are masked (EXPECTED_DYNAMIC). A diff is a FINDING to
 * classify by a person — the run records the ratio, it does not guess
 * LAYOUT_REGRESSION vs TYPOGRAPHY on its own.
 */
const MASKS = ['[class*="hero"]', '[class*="rail"]', '[class*="countdown"]', 'time', '[data-dynamic]'];

test.describe('visual', () => {
  test.skip(() => !/small_low_end_android|mainstream_iphone|laptop_1366/.test(test.info().project.name), 'three representative classes');

  for (const [name, path] of Object.entries({ home: '/', shop: '/shop', cart_empty: '/cart', support: '/support' })) {
    test(`baseline — ${name}`, async ({ page, gp }, testInfo) => {
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(800);
      await page.evaluate(() => document.fonts?.ready);
      const masks = MASKS.map((m) => page.locator(m));
      let diff: string | null = null;
      try { await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false, mask: masks, maxDiffPixelRatio: 0.02 }); }
      catch (e) { diff = String((e as Error).message).split('\n')[0].slice(0, 200); }
      gp.report('visual', { route: name, path, status: diff ? 'DIFF' : 'MATCH_OR_CREATED', detail: diff, classification: diff ? 'NEEDS_HUMAN_CLASSIFICATION' : null, baseline_dir: testInfo.snapshotDir });
    });
  }

  test('baseline — product', async ({ page, gp }, testInfo) => {
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(800);
    let diff: string | null = null;
    try { await expect(page).toHaveScreenshot('product.png', { fullPage: false, mask: MASKS.map((m) => page.locator(m)), maxDiffPixelRatio: 0.02 }); }
    catch (e) { diff = String((e as Error).message).split('\n')[0].slice(0, 200); }
    gp.report('visual', { route: 'product', path: url, status: diff ? 'DIFF' : 'MATCH_OR_CREATED', detail: diff, classification: diff ? 'NEEDS_HUMAN_CLASSIFICATION' : null, baseline_dir: testInfo.snapshotDir });
  });
});
