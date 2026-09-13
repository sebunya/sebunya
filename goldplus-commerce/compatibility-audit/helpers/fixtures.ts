import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { attachMonitor } from './monitor.mjs';
import { startAccounting } from './data-usage.mjs';
import { record } from './report.mjs';
import { EVIDENCE } from './evidence.mjs';

/**
 * Shared fixtures. `gp` gives every spec the target, the stable test product,
 * the evidence class of the current project, the console/network monitor and a
 * `report()` that appends a result cell. Journeys never submit checkout, never
 * pay, never message: the only production side effect any spec may cause is a
 * cart line for a synthetic visitor (a fresh browser context per test).
 */
export interface Gp {
  target: string;
  host: string;
  productUrl: string | null;
  classId: string;
  engine: string;
  tier: string;
  cpu: string | null;
  network: string | null;
  evidence: string;
  monitor: ReturnType<typeof attachMonitor>;
  usage: ReturnType<typeof startAccounting>;
  resolveProduct(page: Page): Promise<string>;
  report(kind: string, payload: Record<string, unknown>): void;
  cell(extra?: Record<string, unknown>): Record<string, unknown>;
}

function resolvedConfig(): { targetUrl: string; productUrl: string } {
  const p = process.env.PERF_AUDIT_RESOLVED_CONFIG;
  if (p && existsSync(p)) { try { const r = JSON.parse(readFileSync(p, 'utf8')).resolved; return { targetUrl: r.targetUrl, productUrl: r.productUrl || '' }; } catch { /* fall through */ } }
  return { targetUrl: process.env.COMPAT_TARGET_URL || 'https://shopgoldplus.com', productUrl: process.env.AUDIT_PRODUCT_URL || '' };
}

export const test = base.extend<{ gp: Gp }>({
  gp: async ({ page }, use, testInfo: TestInfo) => {
    const cfg = resolvedConfig();
    const target = cfg.targetUrl.replace(/\/+$/, '');
    const host = new URL(target).host.replace(/^www\./, '');
    const meta = (testInfo.project.metadata ?? {}) as Record<string, string | null>;
    const monitor = attachMonitor(page, { firstPartyHost: host });
    const usage = startAccounting(page, { firstPartyHost: host });
    const evidence = meta.cpu || meta.network ? EVIDENCE.EMULATED_CONSTRAINED_DEVICE : (meta.engine === 'chromium' && (testInfo.project.use as { isMobile?: boolean }).isMobile ? EVIDENCE.EMULATED_VIEWPORT : EVIDENCE.ENGINE_CONTROL);
    let productCache: string | null = cfg.productUrl || null;
    const gp: Gp = {
      target, host, productUrl: cfg.productUrl || null, classId: String(meta.classId ?? testInfo.project.name), engine: String(meta.engine ?? ''), tier: String(meta.tier ?? ''),
      cpu: meta.cpu ?? null, network: meta.network ?? null, evidence, monitor, usage,
      async resolveProduct(p: Page) {
        if (productCache) return productCache;
        // No AUDIT_PRODUCT_URL configured: take the first product card on /shop and say so (OWNER ACTION: set a stable test product).
        await p.goto(`${target}/shop`, { waitUntil: 'domcontentloaded' });
        const href = await p.locator('main a[href^="/products/"]').first().getAttribute('href');
        if (!href) throw new Error('no product link found on /shop and AUDIT_PRODUCT_URL is not set');
        productCache = target + href;
        record('notes', { kind: 'PRODUCT_RESOLVED_DYNAMICALLY', url: productCache, project: testInfo.project.name });
        return productCache;
      },
      report(kind, payload) { record(kind, { ...gp.cell(), ...payload }); },
      cell(extra = {}) {
        return { project: testInfo.project.name, path: process.env.COMPAT_PATH || 'edge', class_id: gp.classId, engine: gp.engine, tier: gp.tier, cpu_profile: gp.cpu, network_profile: gp.network, evidence: gp.evidence, viewport: (testInfo.project.use as { viewport?: unknown }).viewport ?? null, test: testInfo.title, file: testInfo.file.split('/').slice(-2).join('/'), ...extra };
      },
    };
    await use(gp);
    // Every test leaves its console/network evidence behind, classified.
    const snap = monitor.snapshot();
    if (snap.console.length || snap.network.length) record('console_network', { ...gp.cell(), console: snap.console.slice(0, 30), network: snap.network.slice(0, 50), status: testInfo.status, blocked_by_edge: monitor.blockedByEdge() });
    if (monitor.blockedByEdge()) record('edge_blocked', { ...gp.cell(), status: testInfo.status, note: 'Cloudflare answered a document request with a challenge (cf-mitigated). The cell is BLOCKED_BY_EDGE for this pass; not a storefront defect and not evaded.' });
  },
});

export { expect };

/**
 * Opens the mobile menu, retrying until the handler is bound (the live site's
 * scripts bind late behind Cloudflare Rocket Loader). Returns how long the
 * first working tap took after the call, or null when there is no burger.
 * The delay itself is a finding recorded by browser/early-interaction.spec.ts.
 */
export async function openMobileMenu(page: Page, maxMs = 15000): Promise<number | null> {
  const burger = page.locator('#gpNavBurger');
  if (!(await burger.isVisible().catch(() => false))) return null;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await burger.click();
    await page.waitForTimeout(350);
    if ((await burger.getAttribute('aria-expanded')) === 'true') return Date.now() - t0;
  }
  throw new Error('mobile menu never opened within ' + maxMs + ' ms');
}

/** Waits until the page's own scripts respond (a localStorage write from the checkout draft, or a bound menu). */
export async function waitForHandlers(page: Page, probe: () => Promise<boolean>, maxMs = 15000): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await probe()) return Date.now() - t0; await page.waitForTimeout(400); }
  return -1;
}

/** Assert the page is not blank: has a heading or main landmark with text. */
export async function expectRenderedPage(page: Page): Promise<void> {
  const text = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
  expect(text.length, 'page rendered with visible text').toBeGreaterThan(40);
}

/** Horizontal overflow is the classic responsive defect: the document must not be wider than the viewport. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, (document.scrollingElement?.scrollWidth ?? document.body.scrollWidth) - window.innerWidth));
}

export async function webVitalsSnapshot(page: Page): Promise<{ ttfb_ms: number | null; fcp_ms: number | null; lcp_ms: number | null; cls: number; dom_content_loaded_ms: number | null; load_ms: number | null; long_tasks: number[] }> {
  return page.evaluate(() => new Promise((resolve) => {
    const out = { lcp: null as number | null, cls: 0, long: [] as number[] };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) out.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) out.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
      resolve({ ttfb_ms: nav ? Math.round(nav.responseStart) : null, fcp_ms: paints['first-contentful-paint'] ? Math.round(paints['first-contentful-paint']) : null, lcp_ms: out.lcp ? Math.round(out.lcp) : null, cls: Math.round(out.cls * 1000) / 1000, dom_content_loaded_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : null, load_ms: nav ? Math.round(nav.loadEventEnd) : null, long_tasks: out.long });
    }, 1500);
  }));
}
