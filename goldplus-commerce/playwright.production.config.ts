import { defineConfig, devices } from '@playwright/test';

/**
 * R3.1 C10 — the PRODUCTION browser matrix (read-only storefront proofs
 * against the live release). Deliberately separate from playwright.config.ts,
 * which drives the Slice-13B local-stack suite: that suite needs a local web
 * server and preinstalled browser binaries, while this one needs only public
 * pages and the locally installed chromium.
 *
 *   npx playwright test -c playwright.production.config.ts
 */
export default defineConfig({
  testDir: './tests/e2e-production',
  timeout: 45_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://shopgoldplus.com',
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['iPad Mini'] } },
  ],
});
