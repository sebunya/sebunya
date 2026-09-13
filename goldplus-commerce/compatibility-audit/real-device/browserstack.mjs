// Real-device provider adapter: BrowserStack Automate (Playwright over CDP).
// Verified 2026-09-13 against the public docs: wss://cdp.browserstack.com/playwright?caps=<url-encoded JSON>
// with { browser, os, os_version, device, realMobile, 'browserstack.username',
// 'browserstack.accessKey', 'browserstack.playwrightVersion' }. Without
// BROWSERSTACK_USERNAME + BROWSERSTACK_ACCESS_KEY this reports
// IMPLEMENTED_AWAITING_CREDENTIALS and every real-device cell stays
// AWAITING_REAL_DEVICE. No result is ever fabricated. One provider on purpose.
import { chromium } from '@playwright/test';

export function browserstackStatus(env = process.env) {
  const user = (env.BROWSERSTACK_USERNAME || '').trim(); const key = (env.BROWSERSTACK_ACCESS_KEY || '').trim();
  if (!user || !key) return { status: 'IMPLEMENTED_AWAITING_CREDENTIALS', reason: 'BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY not set (Performance Audit → Settings on the admin, or performance-audit/.env)' };
  return { status: 'CREDENTIALS_PRESENT', reason: null };
}

/** Connects to one real device/browser session. caps come from device-matrix.json entries' `real` block. */
export async function connectReal(real, { user, key, playwrightVersion = '1.61.1', name = 'goldplus-compatibility' }) {
  const caps = { ...real, realMobile: Boolean(real.device), name, build: `goldplus-compat-${new Date().toISOString().slice(0, 10)}`, 'browserstack.username': user, 'browserstack.accessKey': key, 'browserstack.playwrightVersion': playwrightVersion };
  const ws = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
  return chromium.connect(ws, { timeout: 60000 });
}
