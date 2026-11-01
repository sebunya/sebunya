import { test, expect, request as pwRequest } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility gate (final tier). axe-core WCAG 2.1 A/AA on the pages a customer
 * and an operator actually traverse. Serious/critical violations fail; the full
 * violation list is printed so each is fixable rather than merely counted.
 *
 * Config: E2E_WEB_BASE / E2E_API_BASE / E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 */
const WEB = process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:4321';
const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const CUSTOMER_ROUTES = ['/', '/shop', '/cart', '/track-order', '/support/issue', '/privacy'];
const OPERATOR_ROUTES = ['/admin', '/admin/media', '/admin/legal', '/admin/campaigns', '/admin/users'];

let sessionCookie: { name: string; value: string; domain: string; path: string } | null = null;

test.beforeAll(async () => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) return;
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password } });
  if (res.ok()) {
    const body = await res.json().catch(() => null);
    const token = body?.data?.token ?? body?.token;
    if (token) sessionCookie = { name: 'goldplus_session', value: token, domain: new URL(WEB).hostname, path: '/' };
  }
  await ctx.dispose();
});

async function auditPage(page: import('@playwright/test').Page, route: string) {
  await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (results.violations.length > 0) {
    // Print every violation (including moderate/minor) so the report is actionable.
    console.log(`\n[a11y] ${route}`);
    for (const v of results.violations) {
      console.log(`  ${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s))`);
      console.log(`    first: ${v.nodes[0]?.target?.join(' ')}`);
    }
  }
  expect(
    blocking.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`),
    `serious/critical accessibility violations on ${route}`,
  ).toEqual([]);
}

test.describe('customer surfaces meet WCAG 2.1 AA (serious/critical)', () => {
  for (const route of CUSTOMER_ROUTES) {
    test(`a11y ${route}`, async ({ page }) => { await auditPage(page, route); });
  }
});

test.describe('operator surfaces meet WCAG 2.1 AA (serious/critical)', () => {
  test.beforeEach(async ({ context }) => {
    test.skip(!sessionCookie, 'no admin session (set E2E_ADMIN_EMAIL/PASSWORD)');
    if (sessionCookie) await context.addCookies([sessionCookie]);
  });
  for (const route of OPERATOR_ROUTES) {
    test(`a11y ${route}`, async ({ page }) => { await auditPage(page, route); });
  }
});
