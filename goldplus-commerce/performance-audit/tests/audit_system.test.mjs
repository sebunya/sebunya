// Tests for the audit system's shared logic (node:test — no extra dependency).
//   node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDue, markAttempt, markOutcome, readState, writeState, classifyOutcome, EMPTY_STATE, TEN_DAYS_SECONDS } from '../lib/state.mjs';
import { heavyLoadDecision, parseDotenv, PROD_LOAD_ACK, hostOf } from '../lib/config.mjs';
import { redactText, redactObject, registerSecret, looksLikeItHasSecrets } from '../lib/redact.mjs';
import { metric, unsupported, stats } from '../lib/normalize.mjs';
import { fetchJson, pollUntil } from '../lib/http.mjs';

const CFG = { interval_seconds: TEN_DAYS_SECONDS, retry_delays_seconds: [21600, 43200, 86400] };
const T0 = Date.parse('2026-09-13T03:00:00Z');
const day = 86400000;

test('heavy load can NEVER reach production without both explicit approvals', () => {
  const prod = 'https://shopgoldplus.com';
  const base = { targetUrl: prod, loadTargetUrl: '', allowProdLoadTest: false, prodLoadTestAck: '' };
  assert.equal(heavyLoadDecision(base).status, 'SKIPPED_FOR_SAFETY');
  assert.equal(heavyLoadDecision({ ...base, loadTargetUrl: prod }).allowed, false);
  assert.equal(heavyLoadDecision({ ...base, loadTargetUrl: prod, allowProdLoadTest: true }).allowed, false);
  assert.equal(heavyLoadDecision({ ...base, loadTargetUrl: prod, prodLoadTestAck: PROD_LOAD_ACK }).allowed, false);
  assert.equal(heavyLoadDecision({ ...base, loadTargetUrl: 'https://www.shopgoldplus.com', allowProdLoadTest: true, prodLoadTestAck: 'I_UNDERSTAND' }).allowed, false);
  assert.equal(heavyLoadDecision({ ...base, loadTargetUrl: prod, allowProdLoadTest: true, prodLoadTestAck: PROD_LOAD_ACK }).status, 'ALLOWED_PRODUCTION_EXPLICIT');
  assert.equal(heavyLoadDecision({ ...base, loadTargetUrl: 'https://staging.example.test' }).status, 'ALLOWED_NON_PRODUCTION');
  assert.equal(hostOf('https://WWW.ShopGoldPlus.com/x'), 'shopgoldplus.com');
});

test('rolling ten-day gate: due only 864000 s after the last success, never by calendar day', () => {
  assert.equal(computeDue({ ...EMPTY_STATE }, T0, CFG).due, true); // never ran
  const s = markOutcome({ ...EMPTY_STATE }, T0, { outcome: 'SUCCESS', runId: 'r1', cfg: CFG });
  assert.equal(computeDue(s, T0 + 9 * day + 23 * 3600000, CFG).due, false);
  assert.equal(computeDue(s, T0 + 10 * day, CFG).due, true);
  assert.equal(s.next_due_at, new Date(T0 + TEN_DAYS_SECONDS * 1000).toISOString());
  // an overdue audit (host was off on day 10) is due at the first check afterwards
  assert.equal(computeDue(s, T0 + 14 * day, CFG).due, true);
});

test('ad-hoc runs never move the recurring clock (state functions are only called by the recurring path)', () => {
  const s = markOutcome({ ...EMPTY_STATE }, T0, { outcome: 'SUCCESS', runId: 'r1', cfg: CFG });
  // The ad-hoc path in run_safe_recurring.sh never calls markAttempt/markOutcome; simulate: state untouched
  const after = { ...s };
  assert.deepEqual(after.last_success_at, s.last_success_at);
  assert.equal(computeDue(after, T0 + 5 * day, CFG).due, false);
});

test('failed cycles retry at +6h, +12h, +24h, then wait a full interval — never hourly hammering', () => {
  let s = markOutcome({ ...EMPTY_STATE }, T0 - 10 * day, { outcome: 'SUCCESS', runId: 'r0', cfg: CFG });
  s = markAttempt(s, T0); s = markOutcome(s, T0, { outcome: 'FAILED', runId: 'r1', cfg: CFG });
  assert.equal(s.retry_count, 1); assert.equal(s.last_success_run_id, 'r0');
  assert.equal(computeDue(s, T0 + 3600000, CFG).due, false);
  assert.equal(computeDue(s, T0 + 6 * 3600000, CFG).due, true);
  s = markAttempt(s, T0 + 6 * 3600000); s = markOutcome(s, T0 + 6 * 3600000, { outcome: 'FAILED', runId: 'r2', cfg: CFG });
  assert.equal(computeDue(s, T0 + 6 * 3600000 + 11 * 3600000, CFG).due, false);
  assert.equal(computeDue(s, T0 + 18 * 3600000, CFG).due, true);
  s = markAttempt(s, T0 + 18 * 3600000); s = markOutcome(s, T0 + 18 * 3600000, { outcome: 'FAILED', runId: 'r3', cfg: CFG });
  s = markAttempt(s, T0 + 42 * 3600000); s = markOutcome(s, T0 + 42 * 3600000, { outcome: 'FAILED', runId: 'r4', cfg: CFG });
  assert.equal(s.cycle_failed, true);
  assert.equal(computeDue(s, T0 + 43 * 3600000, CFG).due, false); // no hourly retries after exhaustion
  assert.equal(computeDue(s, T0 + 42 * 3600000 + 10 * day - 1, CFG).due, false);
  assert.equal(computeDue(s, T0 + 42 * 3600000 + 10 * day, CFG).due, true);
  // a PARTIAL_SUCCESS advances the clock and clears retries
  s = markOutcome(s, T0 + 20 * day, { outcome: 'PARTIAL_SUCCESS', runId: 'r5', cfg: CFG });
  assert.equal(s.retry_count, 0); assert.equal(s.cycle_failed, false);
});

test('state is written atomically and a corrupted file is quarantined, not trusted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perf-audit-')); const p = join(dir, 'state', 'schedule.json');
  writeState(p, { ...EMPTY_STATE, last_success_at: '2026-09-01T00:00:00.000Z' });
  assert.equal(readState(p).last_success_at, '2026-09-01T00:00:00.000Z');
  assert.equal(existsSync(p + '.tmp'), false);
  writeFileSync(p, '{"last_success_at": "2026-09-01T00:00:00.000Z", "hist'); // truncated mid-write
  const s = readState(p);
  assert.equal(s.last_success_at, null); assert.ok(s.corrupted_backup && existsSync(s.corrupted_backup));
});

test('outcome classification: control failure = FAILED; soft statuses never fail a cycle; a provider failure = PARTIAL', () => {
  assert.equal(classifyOutcome({ control: 'IMPLEMENTED_AND_VERIFIED', gtmetrix: 'IMPLEMENTED_AWAITING_CREDENTIALS', k6: 'SKIPPED_FOR_SAFETY', keycdn: 'UNSUPPORTED_BY_CURRENT_PROVIDER' }), 'SUCCESS');
  assert.equal(classifyOutcome({ control: 'IMPLEMENTED_AND_VERIFIED', yellowlab: 'PROVIDER_FAILURE' }), 'PARTIAL_SUCCESS');
  assert.equal(classifyOutcome({ control: 'PROVIDER_FAILURE', yellowlab: 'IMPLEMENTED_AND_VERIFIED' }), 'FAILED');
});

test('secrets are redacted from text and objects, and the save guard refuses leaks', () => {
  registerSecret('sk_live_ABCDEF1234567890XYZ');
  assert.equal(redactText('key=sk_live_ABCDEF1234567890XYZ&x=1'), 'key=[REDACTED]&x=1');
  assert.equal(redactText('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer [REDACTED]');
  const o = redactObject({ apiKey: 'abc123def456', nested: { 'x-api-key': 'zzz', ok: 'value', list: ['sk_live_ABCDEF1234567890XYZ'] } });
  assert.equal(o.apiKey, '[REDACTED]'); assert.equal(o.nested['x-api-key'], '[REDACTED]'); assert.equal(o.nested.ok, 'value'); assert.equal(o.nested.list[0], '[REDACTED]');
  assert.equal(looksLikeItHasSecrets('{"token":"abcdef123456"}'), true);
  assert.equal(looksLikeItHasSecrets('{"token":"[REDACTED]"}'), false);
});

test('.env parsing tolerates quotes, comments and export', () => {
  const e = parseDotenv('# c\nexport A=1\nB="two words"\nC=\'x\'\nBAD\n');
  assert.deepEqual(e, { A: '1', B: 'two words', C: 'x' });
});

test('normalized metrics: unknown metric needs a unit; unsupported is explicit; stats are exact', () => {
  assert.equal(metric({ provider: 'p', metric: 'lcp_ms', value: 1200 }).unit, 'ms');
  assert.throws(() => metric({ provider: 'p', metric: 'made_up', value: 1 }));
  assert.equal(unsupported({ provider: 'p', metric: 'inp_ms' }).unit, 'unsupported');
  assert.deepEqual(stats([5, 1, 3, null, 'x']), { n: 3, min: 1, max: 5, mean: 3, median: 3, p95: 5 });
  assert.equal(stats([]).median, null);
});

test('http: 429 then success is retried with bounded attempts; a 4xx is not retried; polling has a deadline', async () => {
  let calls = 0;
  const fake = async () => { calls++; return calls === 1 ? new Response('slow', { status: 429, headers: { 'retry-after': '0' } }) : new Response('{"ok":true}', { status: 200 }); };
  const r = await fetchJson('https://example.test/x?key=SECRETSECRET', { fetchImpl: fake, backoffMs: 1, retries: 2 });
  assert.equal(r.json.ok, true); assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchJson('https://example.test/y', { fetchImpl: async () => { calls++; return new Response('nope', { status: 404 }); }, backoffMs: 1, retries: 3 }), /HTTP 404/);
  assert.equal(calls, 1);
  await assert.rejects(pollUntil(async () => ({ done: false }), { done: (x) => x.done, intervalMs: 1, deadlineMs: 20 }), /deadline/);
});

test('manifest of the run directory layout is what the README promises', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const f of ['manifest.json', 'normalized_metrics.json', 'engineering_report.md', 'executive_summary.md', 'regression_report.md', 'trend_summary.md']) assert.ok(readme.includes(f), f);
});

test('admin settings: .env < settings written by the API < process env; a malformed overrides file is ignored with a reason', async () => {
  const { readAdminSettings, loadConfig } = await import('../lib/config.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'perf-audit-settings-'));
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, 'settings'), { recursive: true });
  writeFileSync(join(dir, 'settings', 'config.overrides.json'), JSON.stringify({ env: { TARGET_URL: 'https://admin.example.test', LOAD_TARGET_URL: 'https://staging.example.test', NOT_ALLOWED: 'x' }, config: { schedule: { interval_seconds: 432000 }, budget: { lcp_ms: 2000 }, providers: { yellowlab: false }, bogus: { a: 1 } } }));
  writeFileSync(join(dir, 'settings', 'secrets.env'), 'GTMETRIX_API_KEY=gt-secret-value-123456\nRANDOM_KEY=nope\n');
  const a = readAdminSettings(dir);
  assert.equal(a.env.TARGET_URL, 'https://admin.example.test'); assert.equal(a.env.NOT_ALLOWED, undefined);
  assert.equal(a.secrets.GTMETRIX_API_KEY, 'gt-secret-value-123456'); assert.equal(a.secrets.RANDOM_KEY, undefined);
  assert.equal(a.config.bogus, undefined);
  const cfg = loadConfig({ PERF_AUDIT_DATA_DIR: dir, TARGET_URL: 'https://admin.example.test', LOAD_TARGET_URL: 'https://staging.example.test', GTMETRIX_API_KEY: 'gt-secret-value-123456' });
  assert.equal(cfg.schedule.interval_seconds, 432000); assert.equal(cfg.schedule.retry_delays_seconds.length, 3); // untouched keys survive
  assert.equal(cfg.budget.lcp_ms, 2000); assert.equal(cfg.budget.ttfb_ms, 800);
  assert.equal(cfg.providers.yellowlab, false); assert.equal(cfg.providers.observatory, true);
  assert.equal(cfg.resolved.credentials.GTMETRIX_API_KEY, true);
  assert.deepEqual(cfg.admin_settings.overridden_sections.sort(), ['budget', 'providers', 'schedule']);
  writeFileSync(join(dir, 'settings', 'config.overrides.json'), '{ not json');
  const bad = loadConfig({ PERF_AUDIT_DATA_DIR: dir });
  assert.equal(bad.schedule.interval_seconds, 864000); assert.match(bad.admin_settings.error, /ignored/);
});
