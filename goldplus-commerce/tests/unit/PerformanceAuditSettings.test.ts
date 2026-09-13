import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GetPerformanceAuditSettingsUseCase,
  ResetPerformanceAuditSettingsUseCase,
  UpdatePerformanceAuditSettingsUseCase,
  validateSettingsInput,
} from '../../apps/api/src/application/use-cases/seo-growth/PerformanceAuditSettingsUseCases';
import { FilesystemPerformanceAuditStore } from '../../apps/api/src/infrastructure/performance-audit/FilesystemPerformanceAuditStore';

/**
 * Performance Audit → Settings (2026-09-13): the admin edits what the host
 * runner reads, without a terminal. The API writes settings/config.overrides.json
 * (non-secret) and settings/secrets.env (mode 600); performance-audit/lib/config.mjs
 * layers them over the repository defaults. Production load approvals are never
 * settable here.
 */
const PROD = { productionHost: 'shopgoldplus.com' };

function dataDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'perf-audit-settings-'));
  for (const sub of ['reports', 'state', 'settings']) mkdirSync(join(d, sub), { recursive: true });
  writeFileSync(join(d, 'state/config.effective.json'), JSON.stringify({ resolved: { targetUrl: 'https://shopgoldplus.com', productUrl: '' }, schedule: { interval_seconds: 864000 }, budget: { lcp_ms: 2500 }, providers: { yellowlab: true } }));
  return d;
}

describe('validateSettingsInput', () => {
  it('accepts a full, sane form and converts days to seconds', () => {
    const r = validateSettingsInput({ env: { AUDIT_PRODUCT_URL: 'https://shopgoldplus.com/products/x', LOAD_TARGET_URL: 'https://staging.example.test/' }, intervalDays: '7', pages: { home: '/', shop: '/shop' }, providers: { yellowlab: 'on', keycdn: false }, canary: { enabled: 'on', vus: '2', duration_seconds: '30', paths: '/,/shop' }, budget: { lcp_ms: '2000', cls: '0.1' }, regression: { lcp_pct: '15' }, retention: { keep_runs: '50' }, secrets: { GTMETRIX_API_KEY: 'abc', PERF_AUDIT_ALERT_WEBHOOK_URL: 'https://hooks.example.test/x', WPT_API_KEY: '' } }, PROD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.overrides.config.schedule).toEqual({ interval_seconds: 604800 });
    expect(r.overrides.env.LOAD_TARGET_URL).toBe('https://staging.example.test');
    expect(r.overrides.config.providers).toEqual({ yellowlab: true, keycdn: false });
    expect(r.overrides.config.canary).toEqual({ enabled: true, vus: 2, duration_seconds: 30, paths: ['/', '/shop'] });
    expect(r.secretsToSet).toEqual({ GTMETRIX_API_KEY: 'abc', PERF_AUDIT_ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' });
    expect(r.secretsToClear).toEqual(['WPT_API_KEY']);
  });

  it('never lets heavy load point at the production host from the back office', () => {
    expect(validateSettingsInput({ env: { LOAD_TARGET_URL: 'https://www.shopgoldplus.com' } }, PROD)).toMatchObject({ ok: false, field: 'LOAD_TARGET_URL' });
    expect(validateSettingsInput({ env: { TARGET_URL: 'https://other.example.test', LOAD_TARGET_URL: 'https://shopgoldplus.com' } }, PROD)).toMatchObject({ ok: false, field: 'LOAD_TARGET_URL' });
  });

  it('has no way to express the production approvals', () => {
    const r = validateSettingsInput({ env: { ALLOW_PROD_LOAD_TEST: 'true', PROD_LOAD_TEST_ACK: 'I_UNDERSTAND_THIS_GENERATES_REAL_TRAFFIC' } as never }, PROD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.overrides.env).toEqual({});
  });

  it('bounds the canary so the admin cannot turn it into a load test', () => {
    expect(validateSettingsInput({ canary: { vus: '50' } }, PROD)).toMatchObject({ ok: false, field: 'canary.vus' });
    expect(validateSettingsInput({ canary: { duration_seconds: '600' } }, PROD)).toMatchObject({ ok: false, field: 'canary.duration_seconds' });
  });

  it('rejects bad URLs, unknown keys, out-of-range intervals and multi-line secrets', () => {
    expect(validateSettingsInput({ env: { TARGET_URL: 'http://plain.example.test' } }, PROD)).toMatchObject({ ok: false, field: 'TARGET_URL' });
    expect(validateSettingsInput({ env: { AUDIT_PRODUCT_URL: 'https://elsewhere.example.test/p' } }, PROD)).toMatchObject({ ok: false, field: 'AUDIT_PRODUCT_URL' });
    expect(validateSettingsInput({ budget: { made_up: '1' } }, PROD)).toMatchObject({ ok: false, field: 'budget' });
    expect(validateSettingsInput({ providers: { nope: true } }, PROD)).toMatchObject({ ok: false, field: 'providers' });
    expect(validateSettingsInput({ intervalDays: '0' }, PROD)).toMatchObject({ ok: false, field: 'intervalDays' });
    expect(validateSettingsInput({ intervalDays: '45' }, PROD)).toMatchObject({ ok: false, field: 'intervalDays' });
    expect(validateSettingsInput({ pages: { shop: '/shop' } }, PROD)).toMatchObject({ ok: false, field: 'pages' });
    expect(validateSettingsInput({ secrets: { WPT_API_KEY: 'a\nb' } }, PROD)).toMatchObject({ ok: false, field: 'WPT_API_KEY' });
    expect(validateSettingsInput({ secrets: { PERF_AUDIT_ALERT_WEBHOOK_URL: 'ftp://x' } }, PROD)).toMatchObject({ ok: false, field: 'PERF_AUDIT_ALERT_WEBHOOK_URL' });
  });
});

describe('settings round-trip through the filesystem store', () => {
  it('writes overrides and a mode-600 secrets file, merges partial updates, and never returns secret values', async () => {
    const d = dataDir();
    const store = new FilesystemPerformanceAuditStore(d);
    const update = new UpdatePerformanceAuditSettingsUseCase(store);
    const r1 = await update.execute({ intervalDays: '5', secrets: { GTMETRIX_API_KEY: 'gt-key-1' }, budget: { lcp_ms: '2000' } });
    expect(r1.ok).toBe(true);
    const r2 = await update.execute({ providers: { keycdn: false }, secrets: { WPT_API_KEY: 'wpt-key' } });
    expect(r2.ok).toBe(true);
    const doc = JSON.parse(readFileSync(join(d, 'settings/config.overrides.json'), 'utf8'));
    expect(doc.config.schedule).toEqual({ interval_seconds: 432000 }); // kept from the first save
    expect(doc.config.budget).toEqual({ lcp_ms: 2000 });
    expect(doc.config.providers).toEqual({ keycdn: false });
    const secrets = readFileSync(join(d, 'settings/secrets.env'), 'utf8');
    expect(secrets).toContain('GTMETRIX_API_KEY=gt-key-1');
    expect(secrets).toContain('WPT_API_KEY=wpt-key');
    expect(statSync(join(d, 'settings/secrets.env')).mode & 0o777).toBe(0o600);
    const view = await new GetPerformanceAuditSettingsUseCase(store).execute();
    expect(view.secretsPresent.GTMETRIX_API_KEY).toBe(true);
    expect(view.secretsPresent.SPEEDCURVE_API_KEY).toBe(false);
    expect(JSON.stringify(view)).not.toContain('gt-key-1');
    expect(view.productionHost).toBe('shopgoldplus.com');
    // clearing one credential keeps the other
    const r3 = await update.execute({ secrets: { GTMETRIX_API_KEY: '' } });
    expect(r3.ok && r3.secretsCleared).toEqual(['GTMETRIX_API_KEY']);
    expect(readFileSync(join(d, 'settings/secrets.env'), 'utf8')).not.toContain('gt-key-1');
    expect(readFileSync(join(d, 'settings/secrets.env'), 'utf8')).toContain('WPT_API_KEY=wpt-key');
  });

  it('reset removes overrides and keeps credentials unless asked', async () => {
    const d = dataDir();
    const store = new FilesystemPerformanceAuditStore(d);
    await new UpdatePerformanceAuditSettingsUseCase(store).execute({ intervalDays: '3', secrets: { WPT_API_KEY: 'k' } });
    expect((await new ResetPerformanceAuditSettingsUseCase(store).execute({ clearSecrets: false })).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(d, 'settings/config.overrides.json'), 'utf8')).config).toEqual({});
    expect((await store.secretsPresence(['WPT_API_KEY'])).WPT_API_KEY).toBe(true);
    await new ResetPerformanceAuditSettingsUseCase(store).execute({ clearSecrets: true });
    expect((await store.secretsPresence(['WPT_API_KEY'])).WPT_API_KEY).toBe(false);
  });

  it('refuses when the data directory is not mounted', async () => {
    const r = await new UpdatePerformanceAuditSettingsUseCase(new FilesystemPerformanceAuditStore('/nonexistent/perf-audit')).execute({ intervalDays: '3' });
    expect(r).toMatchObject({ ok: false, code: 'NOT_CONFIGURED', status: 503 });
  });
});
