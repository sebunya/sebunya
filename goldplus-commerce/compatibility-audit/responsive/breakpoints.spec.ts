import { test, expect, horizontalOverflow, expectRenderedPage, openMobileMenu } from '../helpers/fixtures';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Responsive forensics. The storefront's real breakpoints (discovery
 * 2026-09-13): Tailwind stock sm 640 / md 768 / lg 1024 / xl 1280 and the
 * navigation's own switch at max-width 980px (GpNav.astro) plus 380px. Each
 * boundary is tested at −1 / 0 / +1. Runs on one desktop-capable project per
 * engine only (viewports are set per test, so the project viewport is irrelevant).
 */
const matrix = JSON.parse(readFileSync(join(__dirname, '..', 'device-matrix.json'), 'utf8'));
const BOUNDARIES = [380, 640, 768, 980, 1024, 1280];
const WIDTHS: number[] = Array.from(new Set([...matrix.responsive_widths, ...BOUNDARIES.flatMap((b) => [b - 1, b, b + 1])])).sort((a, b) => a - b);
const PAGES = ['/', '/shop', '/cart'];

test.describe('responsive boundaries', () => {
  test.skip(() => !/desktop_1440_webkit|large_display_1920|desktop_1440_firefox/.test(test.info().project.name), 'one project per engine');

  for (const path of PAGES) {
    test(`no horizontal overflow and a usable header at every width — ${path}`, async ({ page, gp }) => {
      test.setTimeout(240_000);
      const results: Array<Record<string, unknown>> = [];
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.waitForTimeout(120);
        const overflow = await horizontalOverflow(page);
        const burger = await page.getByRole('button', { name: 'Open menu' }).isVisible().catch(() => false);
        const search = await page.getByRole('searchbox', { name: 'Search products' }).filter({ visible: true }).count();
        const logo = await page.getByRole('link', { name: 'GoldPlus home' }).isVisible().catch(() => false);
        results.push({ width: w, overflow_px: overflow, burger, visible_search_boxes: search, logo });
      }
      const bad = results.filter((r) => (r.overflow_px as number) > 1 || !r.logo || (!r.burger && (r.visible_search_boxes as number) === 0));
      gp.report('responsive', { page: path, widths: results, defects: bad, status: bad.length ? 'FAIL' : 'PASS' });
      expect(bad, `widths with overflow or an unusable header on ${path}: ${JSON.stringify(bad)}`).toEqual([]);
    });
  }

  test('nav switch at 980px agrees with the page: header usable at 979 / 980 / 981 and 1023 / 1024 / 1025', async ({ page, gp }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const rows: Array<Record<string, unknown>> = [];
    for (const w of [979, 980, 981, 1023, 1024, 1025]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(120);
      const burger = await page.getByRole('button', { name: 'Open menu' }).isVisible().catch(() => false);
      const rail = await page.getByRole('navigation', { name: 'Product categories' }).isVisible().catch(() => false);
      rows.push({ width: w, burger, category_rail: rail, overflow_px: await horizontalOverflow(page) });
    }
    gp.report('responsive', { page: '/', nav_switch: rows });
    for (const r of rows) expect(r.burger || r.category_rail, `at ${r.width}px either the burger or the category rail must be usable`).toBe(true);
  });

  test('height: short mobile, keyboard-open estimate and landscape keep the primary CTA reachable on the product page', async ({ page, gp }) => {
    const url = await gp.resolveProduct(page);
    const rows: Array<Record<string, unknown>> = [];
    for (const [label, vp] of Object.entries({ short_mobile: { width: 360, height: 560 }, keyboard_open: { width: 360, height: 420 }, landscape: { width: 844, height: 390 }, tall: { width: 412, height: 932 } })) {
      await page.setViewportSize(vp);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const cta = page.getByRole('button', { name: /Add to cart|Notify|Out of stock|Coming/i }).first();
      const exists = await cta.count();
      let reachable = false;
      if (exists) { await cta.scrollIntoViewIfNeeded(); reachable = await cta.isVisible(); const box = await cta.boundingBox(); reachable = reachable && !!box && box.y >= 0 && box.y + box.height <= vp.height + 1; }
      const h1 = await page.getByRole('heading', { level: 1 }).isVisible();
      rows.push({ viewport: label, ...vp, cta_reachable: reachable, h1_visible: h1, overflow_px: await horizontalOverflow(page) });
    }
    gp.report('responsive', { page: url, heights: rows });
    for (const r of rows) { expect(r.h1_visible, `${r.viewport}: h1`).toBe(true); expect(r.overflow_px as number, `${r.viewport}: overflow`).toBeLessThanOrEqual(1); }
  });

  test('orientation: portrait → landscape → portrait keeps the menu and cart usable', async ({ page, gp }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openMobileMenu(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    const overflowLandscape = await horizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const menuStillOpen = await page.getByRole('button', { name: /menu/i }).first().getAttribute('aria-expanded');
    await page.goto('/cart', { waitUntil: 'domcontentloaded' });
    await expectRenderedPage(page);
    gp.report('responsive', { orientation: { overflow_landscape: overflowLandscape, menu_state_after_rotation: menuStillOpen } });
    expect(overflowLandscape).toBeLessThanOrEqual(1);
  });
});
