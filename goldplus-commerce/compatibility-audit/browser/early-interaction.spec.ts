import { test, expect } from '../helpers/fixtures';

/**
 * Time-to-interactive-handlers, measured. From the first byte the page polls
 * every 100 ms until the menu button actually responds, and records that
 * moment relative to DOMContentLoaded and load. It also inspects how the
 * page's scripts were delivered: Cloudflare Rocket Loader (found ON on
 * 2026-09-13 ~09:00 UTC, apparently OFF ~09:30 UTC) rewrites
 * <script type="module"> to a deferred type, downloads the nav bundle twice
 * and binds every handler only after window.load; the storefront itself binds
 * within a few milliseconds of DOMContentLoaded. A gap above one second is a
 * P2 finding; above three seconds a P1. Cloudflare-owned when the rewrite is
 * present; application-owned otherwise.
 */
test.describe('early interaction', () => {
  test.skip(() => !/small_low_end_android|mainstream_android|mainstream_iphone|desktop_1440_firefox/.test(test.info().project.name), 'one class per engine plus low-end');

  test('menu handler binding time vs DOMContentLoaded and load; script delivery (Rocket Loader) inspected', async ({ page, gp }) => {
    test.setTimeout(120_000);
    const jsResponses: string[] = [];
    page.on('response', (r) => { if (r.request().resourceType() === 'script') jsResponses.push(r.url().split('/').pop()!.slice(0, 40)); });
    await page.goto('/', { waitUntil: 'commit' });
    const timing = await page.evaluate(() => new Promise<Record<string, unknown>>((resolve) => {
      const out: Record<string, unknown> = { dcl_ms: null, load_ms: null, bound_ms: null, tries: 0, mobile_menu_present: false };
      const mark = () => { const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined; if (nav) { out.dcl_ms = out.dcl_ms ?? (nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null); out.load_ms = out.load_ms ?? (nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null); } };
      const iv = setInterval(() => {
        (out.tries as number)++; mark();
        const b = document.getElementById('gpNavBurger');
        if (b && getComputedStyle(b).display !== 'none') {
          out.mobile_menu_present = true;
          b.click();
          if (b.getAttribute('aria-expanded') === 'true') { out.bound_ms = Math.round(performance.now()); b.click(); clearInterval(iv); setTimeout(() => { mark(); finish(); }, 1200); return; }
        } else if (b) { out.mobile_menu_present = false; }
        if ((out.tries as number) > 600) { clearInterval(iv); mark(); finish(); }
      }, 100);
      function finish() {
        mark();
        const scripts = [...document.scripts];
        out.delivery = { rocket_loader: scripts.some((s) => /rocket-loader/.test(s.src)) || scripts.some((s) => /-module$|-text\/javascript$/.test(s.type)), rewritten_script_types: scripts.filter((s) => /-module$|-text\/javascript$/.test(s.type)).length, hoisted_script_tags: scripts.filter((s) => /hoisted\./.test(s.src)).map((s) => `${s.type}:${s.src.split('/').pop()}`), module_tags: scripts.filter((s) => s.type === 'module').length };
        out.hoisted_resource_timeline = performance.getEntriesByType('resource').filter((e) => /hoisted/.test(e.name)).map((e) => ({ start_ms: Math.round(e.startTime), end_ms: Math.round(e.responseEnd), transfer_bytes: Math.round((e as PerformanceResourceTiming).transferSize) }));
        resolve(out);
      }
    }));
    const dupes = jsResponses.filter((u, i, a) => a.indexOf(u) !== i);
    const bound = timing.bound_ms as number | null; const dcl = timing.dcl_ms as number | null; const load = timing.load_ms as number | null;
    const gapAfterDcl = bound != null && dcl != null ? bound - dcl : null;
    const mobile = timing.mobile_menu_present as boolean;
    const delivery = timing.delivery as { rocket_loader: boolean };
    const severity = !mobile ? null : bound == null ? 'P1' : gapAfterDcl != null && gapAfterDcl > 3000 ? 'P1' : gapAfterDcl != null && gapAfterDcl > 1000 ? 'P2' : null;
    gp.report('early_interaction', {
      ...timing, handler_bound_after_dcl_ms: gapAfterDcl, handler_bound_after_load_ms: bound != null && load != null ? bound - load : null, duplicate_script_downloads: dupes,
      status: severity ? 'FINDING' : 'PASS', severity, owner: delivery.rocket_loader ? 'CLOUDFLARE' : 'APPLICATION',
      note: severity ? `Menu handler responded ${gapAfterDcl ?? 'never'} ms after DOMContentLoaded (${bound == null ? 'not within 60 s' : `${bound} ms after navigation start`}).${delivery.rocket_loader ? ' Cloudflare Rocket Loader rewrites the module scripts and defers them past window.load. OWNER ACTION: switch Rocket Loader OFF.' : ''}${dupes.length ? ` Same script downloaded twice: ${dupes.join(', ')}.` : ''}` : null,
    });
    if (mobile) expect(bound, 'menu handler eventually bound').not.toBeNull();
  });
});
