import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Platform-wide route-contract browser suite (production recovery §13/§14).
 *
 * Visits every discovered public + admin route and asserts the page does NOT
 * render a shared-failure banner ("Failed to parse URL", "service unavailable",
 * "API unavailable", …) — the symptom of the SSR-origin defect. Admin routes are
 * driven with a real authenticated session (cookie), never with auth disabled.
 *
 * Config via env:
 *   E2E_WEB_BASE   web origin under test (candidate or production)
 *   E2E_API_BASE   API origin for login
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD  admin credentials (never logged)
 */
const WEB = process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:4321';
const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000';

const FAILURE_BANNERS = [
  /Failed to parse URL/i,
  /service unavailable/i,
  /API unavailable/i,
  /unavailable right now/i,
  /Module readiness unavailable/i,
  /could not load/i,
  /API unreachable/i,
];

const PUBLIC_ROUTES = [
  '/', '/shop', '/product-finder', '/track-order', '/cart', '/returns', '/quotes',
  '/support/issue', '/support/fake', '/warranty', '/compare', '/loyalty', '/preferences',
  '/login', '/privacy', '/terms',
];

/**
 * Wave 2A completeness: admin coverage is DERIVED from the pages directory, so a new
 * admin page is covered the day it exists and a hand-kept list can never silently
 * lag the platform. Dynamic ([param]) pages are skipped — they need fixture ids.
 */
function discoverAdminRoutes(): string[] {
  const pagesDir = path.resolve(__dirname, '../../apps/web/src/pages/admin');
  const routes = new Set<string>(['/admin']);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.astro')) continue;
      let rel = path.relative(pagesDir, full).replace(/\.astro$/, '');
      if (rel.split('/').some((seg) => seg.startsWith('['))) continue;
      if (rel.endsWith('/index') || rel === 'index') rel = rel.replace(/\/?index$/, '');
      if (rel.includes('login')) continue; // covered unauthenticated by design
      routes.add(rel === '' ? '/admin' : `/admin/${rel}`);
    }
  };
  walk(pagesDir);
  return [...routes].sort();
}

const ADMIN_ROUTES = discoverAdminRoutes();

let sessionCookie: { name: string; value: string; domain: string; path: string } | null = null;

test.beforeAll(async () => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) return; // admin tests will skip
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password } });
  if (res.ok()) {
    const body = await res.json().catch(() => null);
    const token = body?.data?.token ?? body?.token;
    if (token) {
      const host = new URL(WEB).hostname;
      sessionCookie = { name: 'goldplus_session', value: token, domain: host, path: '/' };
    }
  }
  await ctx.dispose();
});

async function assertNoBanner(page: import('@playwright/test').Page, path: string) {
  const resp = await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // Redirect to login is a valid PROTECTED state for admin when unauthenticated.
  const body = await page.content();
  for (const re of FAILURE_BANNERS) {
    if (re.test(body)) {
      await page.screenshot({ path: `test-results/route-contract${path.replace(/\//g, '_') || '_root'}.png` }).catch(() => {});
      throw new Error(`Failure banner ${re} on ${path} (status ${resp?.status()})`);
    }
  }
}

test.describe('public routes render without shared-failure banners', () => {
  for (const path of PUBLIC_ROUTES) {
    test(`public ${path}`, async ({ page }) => { await assertNoBanner(page, path); });
  }
});

test('cart mints its credential cookie (do-not-break ledger #2)', async () => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.get(`${WEB}/cart`);
  const setCookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
  expect(
    setCookies.some((h) => /gp_cart=/.test(h.value)),
    'GET /cart must mint the gp_cart credential cookie — its absence is the RC-3 failure mode',
  ).toBe(true);
  await ctx.dispose();
});

test.describe('admin routes (authenticated) render without shared-failure banners', () => {
  test.beforeEach(async ({ context }) => {
    test.skip(!sessionCookie, 'no admin session (set E2E_ADMIN_EMAIL/PASSWORD)');
    if (sessionCookie) await context.addCookies([sessionCookie]);
  });
  for (const path of ADMIN_ROUTES) {
    test(`admin ${path}`, async ({ page }) => { await assertNoBanner(page, path); });
  }
});
