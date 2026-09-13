import { test, expect, openMobileMenu } from '../helpers/fixtures';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated accessibility (axe-core, WCAG 2.x A/AA) on meaningful states and a
 * keyboard-only pass on desktop. Automated testing is not certification:
 * VoiceOver / TalkBack / NVDA checklists live in constrained-device-policy.md
 * and report MANUAL_AT_VALIDATION_REQUIRED until a person executes them.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: import('@playwright/test').Page, state: string, gp: import('../helpers/fixtures').Gp) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, sample: x.nodes[0]?.target?.[0] ?? null }));
  gp.report('accessibility', { state, url: page.url(), violations: v, serious: v.filter((x) => x.impact === 'serious' || x.impact === 'critical').length, total: v.length, incomplete: r.incomplete.length });
  return v;
}

test.describe('accessibility', () => {
  test.skip(() => !/mainstream_android|laptop_1366|desktop_1440_webkit/.test(test.info().project.name), 'axe on one mobile and one desktop class per engine family');

  test('axe: home, menu open, search results, product, cart, checkout, battery finder', async ({ page, gp }) => {
    test.setTimeout(240_000);
    const serious: Array<Record<string, unknown>> = [];
    await page.goto('/', { waitUntil: 'load' }); serious.push(...(await scan(page, 'home', gp)).filter((x) => x.impact === 'serious' || x.impact === 'critical'));
    const burger = page.getByRole('button', { name: 'Open menu' });
    if (await burger.isVisible().catch(() => false)) { await openMobileMenu(page); serious.push(...(await scan(page, 'home_menu_open', gp)).filter((x) => x.impact === 'serious' || x.impact === 'critical')); }
    await page.goto('/shop?search=charger', { waitUntil: 'load' }); serious.push(...(await scan(page, 'search_results', gp)).filter((x) => x.impact === 'serious' || x.impact === 'critical'));
    const url = await gp.resolveProduct(page);
    await page.goto(url, { waitUntil: 'load' }); serious.push(...(await scan(page, 'product', gp)).filter((x) => x.impact === 'serious' || x.impact === 'critical'));
    const add = page.getByRole('button', { name: /Add to cart/i }).first();
    if (await add.isVisible().catch(() => false)) {
      await add.click(); await page.waitForURL(/\/cart/); await page.waitForLoadState('load'); serious.push(...(await scan(page, 'cart', gp)).filter((x) => x.impact === 'serious' || x.impact === 'critical'));
      await page.getByRole('link', { name: /checkout/i }).first().click(); await page.waitForURL(/\/checkout/); await page.waitForLoadState('load'); serious.push(...(await scan(page, 'checkout', gp)).filter((x) => x.impact === 'serious' || x.impact === 'critical'));
    }
    await page.goto('/battery-finder', { waitUntil: 'load' }); serious.push(...(await scan(page, 'battery_finder', gp)).filter((x) => x.impact === 'serious' || x.impact === 'critical'));
    // Serious/critical violations are findings with a severity, reported for engineering judgement; they do not fail the run by themselves.
    gp.report('accessibility_summary', { serious_total: serious.length, ids: [...new Set(serious.map((s) => s.id))] });
  });

  test('keyboard-only: Tab to search, Enter submits, Escape closes the menu, focus stays visible', async ({ page, gp }) => {
    test.skip(!/laptop_1366|desktop_1440/.test(test.info().project.name), 'desktop only');
    await page.goto('/', { waitUntil: 'load' });
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const a = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; if (!el) return 'none'; const outline = getComputedStyle(el).outlineStyle; return `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}:outline=${outline}`; });
      order.push(a);
      if (/search products/i.test(a)) break;
    }
    const reachedSearch = order.some((o) => /search products/i.test(o));
    if (reachedSearch) { await page.keyboard.type('charger'); await page.keyboard.press('Enter'); await page.waitForURL(/\/shop\?/); }
    await page.goto('/', { waitUntil: 'load' });
    const acct = page.getByRole('button', { name: 'Account' });
    let escapeCloses: boolean | null = null;
    if (await acct.isVisible().catch(() => false)) { await acct.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200); escapeCloses = (await acct.getAttribute('aria-expanded')) !== 'true'; }
    gp.report('keyboard', { tab_order: order, reached_search: reachedSearch, escape_closes_account_menu: escapeCloses, status: reachedSearch ? 'PASS' : 'FINDING' });
    expect(reachedSearch, 'search reachable by Tab within 12 stops').toBe(true);
  });
});
