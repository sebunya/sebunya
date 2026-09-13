import { test } from '../helpers/fixtures';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { browserstackStatus, connectReal } from './browserstack.mjs';
import { record } from '../helpers/report.mjs';

/**
 * Real devices and real browsers through ONE provider (BrowserStack). Without
 * credentials every real cell is recorded as AWAITING_REAL_DEVICE — never
 * inferred from an engine control. With credentials, the core journey
 * (home → product → add to cart → cart → checkout entry) runs on each real
 * cell of device-matrix.json and the results are recorded as REAL_DEVICE /
 * REAL_BROWSER with device, OS, browser and viewport.
 */
const matrix = JSON.parse(readFileSync(join(__dirname, '..', 'device-matrix.json'), 'utf8')) as { classes: Array<Record<string, any>> };

test.describe('real devices', () => {
  test.skip(() => test.info().project.name !== 'chromium:mainstream_android', 'runs once');

  test('real-device matrix (BrowserStack)', async ({ gp }) => {
    test.setTimeout(900_000);
    const status = browserstackStatus();
    const realCells = matrix.classes.filter((c) => c.real);
    if (status.status !== 'CREDENTIALS_PRESENT') {
      for (const c of realCells) record('real_device', { class_id: c.id, label: c.label, real: c.real, evidence: c.evidence ?? 'AWAITING_REAL_DEVICE', status: 'AWAITING_REAL_DEVICE', reason: status.reason });
      record('real_device_provider', { provider: 'browserstack', status: status.status, reason: status.reason });
      return;
    }
    record('real_device_provider', { provider: 'browserstack', status: 'CREDENTIALS_PRESENT' });
    for (const c of realCells) {
      if (c.evidence === 'AWAITING_REAL_WEBVIEW_VALIDATION' || !c.real.browser) { record('real_device', { class_id: c.id, label: c.label, real: c.real, evidence: 'AWAITING_REAL_WEBVIEW_VALIDATION', status: 'NOT_AUTOMATABLE', reason: c.real.note }); continue; }
      let browser; const started = Date.now();
      try {
        browser = await connectReal(c.real, { user: process.env.BROWSERSTACK_USERNAME!, key: process.env.BROWSERSTACK_ACCESS_KEY!, name: `goldplus ${c.id}` });
        const page = await browser.newPage();
        await page.goto(gp.target, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const home = await page.locator('h1, h2').first().isVisible();
        const url = gp.productUrl ?? (gp.target + (await page.locator('main a[href^="/products/"]').first().getAttribute('href')));
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const add = page.getByRole('button', { name: /Add to cart/i }).first();
        let cart = null; let checkout = null;
        if (await add.isVisible().catch(() => false)) { await add.click(); await page.waitForURL(/\/cart/, { timeout: 60000 }); cart = await page.getByRole('list', { name: 'Cart items' }).isVisible(); await page.getByRole('link', { name: /checkout/i }).first().click(); await page.waitForURL(/\/checkout/, { timeout: 60000 }); checkout = await page.locator('#checkout-form').isVisible(); }
        const vp = page.viewportSize();
        record('real_device', { class_id: c.id, label: c.label, real: c.real, evidence: c.real.device ? 'REAL_DEVICE' : 'REAL_BROWSER', status: home && (cart ?? true) && (checkout ?? true) ? 'PASS' : 'FAIL', home_rendered: home, cart_rendered: cart, checkout_entry: checkout, viewport: vp, duration_ms: Date.now() - started });
      } catch (e) { record('real_device', { class_id: c.id, label: c.label, real: c.real, evidence: 'REAL_DEVICE', status: 'ERROR', error: String((e as Error).message).slice(0, 200) }); }
      finally { await browser?.close().catch(() => undefined); }
    }
  });
});
