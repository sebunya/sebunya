import { defineConfig, devices } from '@playwright/test';

/**
 * Slice 13B browser acceptance. Chromium desktop + mobile run in this
 * environment (preinstalled at PLAYWRIGHT_BROWSERS_PATH); Firefox/WebKit
 * projects are declared but require an environment where their binaries are
 * permitted (this container forbids browser downloads).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:4321',
    launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH || undefined },
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 14'] } },
  ],
});
