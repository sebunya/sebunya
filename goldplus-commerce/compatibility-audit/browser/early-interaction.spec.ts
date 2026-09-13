import { test, expect } from '../helpers/fixtures';

/**
 * Time-to-interactive-handlers. A customer on a slow connection taps the menu
 * or starts typing long before every image has loaded. This test taps the menu
 * right after DOMContentLoaded and again after load, and inspects how the
 * page's scripts are delivered. Discovery 2026-09-13: Cloudflare Rocket Loader
 * rewrites <script type="module"> to a deferred type, injects a second copy
 * (the nav bundle is downloaded twice) and executes it after window.load, so
 * early taps are lost. Cloudflare-owned; reported, never "fixed" in code.
 */
test.describe('early interaction', () => {
  test.skip(() => !/small_low_end_android|mainstream_android|mainstream_iphone|desktop_1440_firefox/.test(test.info().project.name), 'one class per engine plus low-end');

  test('menu responds to a tap right after DOMContentLoaded; script delivery is inspected for Rocket Loader', async ({ page, gp }) => {
    const jsResponses: string[] = [];
    page.on('response', (r) => { if (r.request().resourceType() === 'script') jsResponses.push(r.url().split('/').pop()!.slice(0, 40)); });
    const t0 = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const tDcl = Date.now() - t0;
    const burger = page.locator('#gpNavBurger');
    const mobile = await burger.isVisible().catch(() => false);
    let earlyWorked: boolean | null = null; let lateWorked: boolean | null = null;
    if (mobile) {
      await burger.click(); await page.waitForTimeout(400);
      earlyWorked = (await burger.getAttribute('aria-expanded')) === 'true';
      if (earlyWorked) { await burger.click(); await page.waitForTimeout(300); }
    }
    await page.waitForLoadState('load'); const tLoad = Date.now() - t0; await page.waitForTimeout(600);
    if (mobile) { await burger.click(); await page.waitForTimeout(400); lateWorked = (await burger.getAttribute('aria-expanded')) === 'true'; }
    const delivery = await page.evaluate(() => {
      const scripts = [...document.scripts];
      const rewritten = scripts.filter((s) => /-module$|-text\/javascript$/.test(s.type)).length;
      const rocket = scripts.some((s) => /rocket-loader/.test(s.src)) || rewritten > 0;
      const hoisted = scripts.filter((s) => /hoisted\./.test(s.src)).map((s) => `${s.type}:${s.src.split('/').pop()}`);
      return { rocket_loader: rocket, rewritten_script_types: rewritten, hoisted_script_tags: hoisted, module_tags: scripts.filter((s) => s.type === 'module').length };
    });
    const dupes = jsResponses.filter((u, i, a) => a.indexOf(u) !== i);
    const finding = mobile && earlyWorked === false && lateWorked === true;
    gp.report('early_interaction', {
      dcl_ms: tDcl, load_ms: tLoad, mobile_menu_present: mobile, tap_after_dcl_worked: earlyWorked, tap_after_load_worked: lateWorked, delivery, duplicate_script_downloads: dupes,
      status: finding ? 'FINDING' : 'PASS', severity: finding ? 'P1' : null, owner: delivery.rocket_loader ? 'CLOUDFLARE' : 'APPLICATION',
      note: finding ? `Handlers bind only after window.load (${tLoad} ms here; far later on a slow connection). ${delivery.rocket_loader ? 'Cloudflare Rocket Loader rewrites the module scripts and defers them; the storefront itself binds synchronously. OWNER ACTION: switch Rocket Loader OFF (docs/hardening/cloudflare-lighthouse-owner-settings.md).' : ''}${dupes.length ? ` The same script was downloaded twice: ${dupes.join(', ')}.` : ''}` : null,
    });
    expect(mobile ? lateWorked : true, 'menu works after load').toBe(true);
  });
});
