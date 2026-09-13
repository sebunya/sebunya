import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * GoldPlus compatibility programme — Playwright projects are the ENGINE and
 * VIEWPORT matrix from device-matrix.json. Every project name encodes engine +
 * class; the fixtures derive the evidence class from it so no result is ever
 * labelled "Safari" or "real low-end Android" unless a real-device session
 * produced it. Test-only: nothing here ships to customers.
 */
const matrix = JSON.parse(readFileSync(join(__dirname, 'device-matrix.json'), 'utf8')) as { classes: Array<Record<string, any>> };
const OUT = process.env.COMPAT_OUT_DIR || join(__dirname, 'out', 'latest');
const target = (process.env.COMPAT_TARGET_URL || 'https://shopgoldplus.com').replace(/\/+$/, '');

const projects = matrix.classes
  .filter((c) => c.engine)
  .map((c) => ({
    name: `${c.engine}:${c.id}`,
    metadata: { classId: c.id, engine: c.engine, tier: c.tier, cpu: c.cpu ?? null, network: c.network ?? null },
    use: {
      browserName: c.engine as 'chromium' | 'firefox' | 'webkit',
      viewport: c.viewport,
      deviceScaleFactor: c.deviceScaleFactor,
      isMobile: c.engine === 'firefox' ? false : c.isMobile, // Firefox has no mobile emulation in Playwright
      hasTouch: c.hasTouch,
      userAgent: c.ua,
    },
  }));

export default defineConfig({
  testDir: '.',
  testMatch: ['journeys/**/*.spec.ts', 'browser/**/*.spec.ts', 'mobile/**/*.spec.ts', 'low-end/**/*.spec.ts', 'responsive/**/*.spec.ts', 'network/**/*.spec.ts', 'data-usage/**/*.spec.ts', 'pwa/**/*.spec.ts', 'accessibility/**/*.spec.ts', 'visual/**/*.spec.ts', 'real-device/**/*.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide', scale: 'css' } },
  fullyParallel: false,
  workers: Number(process.env.COMPAT_WORKERS || 1), // the audit shares a 2-vCPU production host
  retries: 0, // a flaky result is a finding, not something to hide with retries
  reporter: [['list'], ['json', { outputFile: join(OUT, 'playwright-results.json') }]],
  outputDir: join(OUT, 'test-results'),
  snapshotPathTemplate: `${process.env.COMPAT_BASELINE_DIR || join(__dirname, 'baselines')}/{projectName}/{testFilePath}/{arg}{ext}`,
  updateSnapshots: (process.env.COMPAT_UPDATE_SNAPSHOTS as 'all' | 'missing' | 'none') || 'missing',
  use: {
    baseURL: target,
    ignoreHTTPSErrors: false,
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects,
});
