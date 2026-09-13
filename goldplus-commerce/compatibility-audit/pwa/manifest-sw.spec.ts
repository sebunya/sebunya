import { test, expect } from '../helpers/fixtures';

/**
 * PWA discovery and safety. Classifies GoldPlus (NOT_A_PWA / PWA_FOUNDATION_ONLY /
 * INSTALLABLE_PWA / ADVANCED_PWA) from what the live site serves, validates the
 * manifest and icons, inspects the service worker as delivered (scope, precache,
 * strategy, takeover, sensitive-route bypass), and tests offline / eviction
 * behaviour. Installation and standalone launch on real platforms are
 * AWAITING_REAL_DEVICE; nothing here adds PWA capability.
 */
const SENSITIVE = ['/admin', '/checkout', '/cart', '/payment', '/api', '/dealers/dashboard', '/account', '/orders', '/track-order'];

test.describe('pwa', () => {
  test.skip(() => !/mainstream_android|mainstream_iphone|desktop_1440_firefox/.test(test.info().project.name), 'one class per engine');

  test('manifest: fields, MIME, icons resolve, scope/start_url', async ({ page, request, gp }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href, 'manifest linked from the document').toBeTruthy();
    const res = await request.get(new URL(href!, gp.target).href);
    const ct = res.headers()['content-type'] ?? '';
    const m = await res.json();
    const icons: Array<Record<string, unknown>> = [];
    for (const ic of m.icons ?? []) { const r = await request.get(new URL(ic.src, gp.target).href); icons.push({ src: ic.src, sizes: ic.sizes, type: ic.type, purpose: ic.purpose ?? 'any', status: r.status(), content_type: r.headers()['content-type'] ?? '', bytes: (await r.body()).length }); }
    const findings: string[] = [];
    if (!/json/.test(ct)) findings.push(`manifest content-type is "${ct}" (expected application/manifest+json or application/json)`);
    for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons']) if (m[k] === undefined) findings.push(`missing ${k}`);
    if (!m.id) findings.push('no "id" (Chromium uses start_url as the identity; recommended for stable identity across start_url changes)');
    if (!icons.some((i) => String(i.sizes).includes('512') && i.status === 200)) findings.push('no 512px icon resolves');
    if (!icons.some((i) => String(i.purpose).includes('maskable') && i.status === 200)) findings.push('no maskable icon resolves');
    for (const i of icons) if (i.status !== 200) findings.push(`icon ${i.src} → HTTP ${i.status}`);
    gp.report('manifest', { href, content_type: ct, fields: { name: m.name, short_name: m.short_name, id: m.id ?? null, start_url: m.start_url, scope: m.scope, display: m.display, display_override: m.display_override ?? null, theme_color: m.theme_color, background_color: m.background_color, shortcuts: (m.shortcuts ?? []).length }, icons, findings, status: findings.length ? 'FINDING' : 'PASS' });
    expect(res.status()).toBe(200);
  });

  test('service worker as delivered: registration, scope, precache, strategy, takeover, sensitive bypass', async ({ page, request, gp }) => {
    test.setTimeout(120_000);
    const sw = await request.get(`${gp.target}/sw.js`);
    const src = await sw.text();
    const staticFacts = {
      bytes: src.length, cache_name: (src.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1] ?? null,
      precache_entries: (src.match(/PRECACHE\w*\s*=\s*\[([\s\S]*?)\]/) || ['', ''])[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean),
      skip_waiting: /skipWaiting\(\)/.test(src), clients_claim: /clients\.claim\(\)/.test(src), runtime_cache_writes: /cache\.put\(|\.put\(/.test(src),
      sensitive_routes_listed: SENSITIVE.filter((r) => src.includes(`'${r}'`) || src.includes(`"${r}"`)),
    };
    await page.goto('/', { waitUntil: 'load' });
    const runtime = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]) as ServiceWorkerRegistration | null;
      const keys = 'caches' in window ? await caches.keys() : [];
      let precached: string[] = [];
      for (const k of keys) { const c = await caches.open(k); precached = precached.concat((await c.keys()).map((r) => new URL(r.url).pathname)); }
      return { supported: true, registered: !!reg, scope: reg?.scope ?? null, active: !!reg?.active, cache_keys: keys, precached };
    });
    // Sensitive routes must never be answered by the worker.
    // A logged-out /account redirects to /login, which is not sensitive: judge the FINAL url, and record the redirect.
    const swServed: Record<string, boolean | null> = {}; const finalUrls: Record<string, string> = {};
    for (const path of ['/cart', '/checkout', '/account']) {
      const r = await page.goto(path, { waitUntil: 'domcontentloaded' });
      const finalPath = r ? new URL(r.url()).pathname : path; finalUrls[path] = finalPath;
      const stillSensitive = SENSITIVE.some((sp) => finalPath.startsWith(sp));
      swServed[path] = r ? (stillSensitive ? r.fromServiceWorker() : false) : null;
    }
    const findings: string[] = [];
    if (staticFacts.skip_waiting && staticFacts.clients_claim) findings.push('skipWaiting + clients.claim: a new worker takes over open tabs immediately (no waiting worker, no update prompt). Safe today only because sensitive routes bypass the worker and nothing is runtime-cached; revisit before any runtime caching is added.');
    if (!staticFacts.runtime_cache_writes) findings.push('cache-first branch never writes: only the precache list can ever be served from cache (design note, not a defect).');
    if (Object.values(swServed).some((v) => v === true)) findings.push('a sensitive route was served by the service worker');
    const iconsInPrecache = staticFacts.precache_entries.filter((p) => /icon|\.svg|\.png/.test(p));
    gp.report('service_worker', { static: staticFacts, runtime, sensitive_served_by_sw: swServed, sensitive_final_urls: finalUrls, icons_precached: iconsInPrecache, findings, status: Object.values(swServed).some((v) => v === true) ? 'FAIL' : 'PASS' });
    expect(sw.status()).toBe(200);
    expect(Object.values(swServed).some((v) => v === true), 'sensitive route served by SW').toBe(false);
  });

  test('offline: navigations fall back to the offline page (never blank, never a false success); eviction recovers', async ({ page, gp }) => {
    test.skip(gp.engine !== 'chromium', 'setOffline + SW navigation fallback is exercised on Chromium; WebKit/Firefox SW offline behaviour AWAITING_REAL_DEVICE');
    test.setTimeout(150_000);
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]));
    await page.context().setOffline(true);
    const outcomes: Record<string, string> = {};
    for (const path of ['/shop', '/products/does-not-exist-offline-probe', '/offline']) {
      try { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20000 }); const t = (await page.locator('body').innerText().catch(() => '')).trim(); outcomes[path] = t.length < 20 ? `blank_or_bare:${t.slice(0, 20)}` : (/offline|connection/i.test(t) ? 'offline_page' : 'precached_snapshot'); }
      catch { outcomes[path] = 'navigation_error'; }
    }
    await page.context().setOffline(false);
    // Cache eviction: delete every cache, unregister, then browse again.
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); });
    await page.goto('/shop', { waitUntil: 'domcontentloaded' });
    const recovered = (await page.locator('body').innerText()).length > 100;
    const findings: string[] = [];
    if (Object.values(outcomes).some((o) => o.startsWith('blank'))) findings.push(`offline produced a bare response: ${JSON.stringify(outcomes)}`);
    gp.report('offline', { outcomes, recovered_after_eviction: recovered, findings, status: findings.length ? 'FINDING' : 'PASS' });
    expect(recovered).toBe(true);
  });

  test('capability classification per engine', async ({ page, gp }) => {
    await page.goto('/', { waitUntil: 'load' });
    const caps = await page.evaluate(() => ({
      serviceWorker: 'serviceWorker' in navigator, cacheStorage: 'caches' in window, push: 'PushManager' in window, notifications: 'Notification' in window,
      backgroundSync: 'SyncManager' in window, periodicSync: 'PeriodicSyncManager' in window, share: 'share' in navigator, badging: 'setAppBadge' in navigator,
      beforeinstallprompt: 'onbeforeinstallprompt' in window, displayModeStandalone: matchMedia('(display-mode: standalone)').matches, storageEstimate: 'storage' in navigator && 'estimate' in navigator.storage,
    }));
    gp.report('pwa_capabilities', { engine: gp.engine, platform_support: caps, goldplus_implementation: { manifest: true, service_worker: true, offline_page: true, install_prompt_ux: false, standalone_adaptation: false, push: false, notifications: false, background_sync: false, periodic_sync: false, share_target: false, badging: false, shortcuts: false } });
  });
});
