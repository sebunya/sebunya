#!/usr/bin/env node
// Loader.io — API v2 (verified 2026-09-13 at loader.io/docs/v2): base
// https://api.loader.io/v2, header loaderio-auth. Targets must be verified;
// Loader.io's file method serves loaderio-<token>.txt from the site root. For
// GoldPlus the least invasive mechanism is a STATIC file in apps/web/public
// (Astro serves /public verbatim; no runtime code, no route) — this script
// prints the exact file to add once LOADERIO_VERIFICATION_TOKEN is known.
//
// Heavy test requested: 0 → 1000 clients over 60 s ("per-test" type). It is a
// heavy load and passes through the same dual production gate as k6/Artillery:
// with no safe LOAD_TARGET_URL it is SKIPPED_FOR_SAFETY and nothing is created.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runProvider, awaitingCredentials } from './lib/provider.mjs';
import { metric } from './lib/normalize.mjs';
import { fetchJson, pollUntil } from './lib/http.mjs';
import { AUDIT_ROOT, hostOf } from './lib/config.mjs';

const BASE = 'https://api.loader.io/v2';

runProvider('loaderio', async (ctx) => {
  const key = (ctx.env.LOADERIO_API_KEY || '').trim();
  const token = (ctx.env.LOADERIO_VERIFICATION_TOKEN || '').trim();
  const verificationFile = token ? resolve(AUDIT_ROOT, '..', 'apps/web/public', `loaderio-${token}.txt`) : null;
  const verificationNote = token
    ? `verification file ${existsSync(verificationFile) ? 'present' : 'MISSING'}: apps/web/public/loaderio-${token}.txt (content: loaderio-${token})`
    : 'set LOADERIO_VERIFICATION_TOKEN (from loader.io → target host → verify by file) and commit apps/web/public/loaderio-<token>.txt containing loaderio-<token>';
  if (!ctx.heavy.allowed) {
    return { status: 'SKIPPED_FOR_SAFETY', summary: ctx.heavy.reason, limitations: verificationNote, metrics: [metric({ provider: 'loaderio', page: 'home', metric: 'p95_latency_ms', value: null, unit: 'unsupported', kind: 'load', note: 'heavy load skipped for safety' })] };
  }
  if (!key) return awaitingCredentials('LOADERIO_API_KEY', `Create an API key at loader.io (Settings → API). ${verificationNote}`);
  const headers = { 'loaderio-auth': key, 'Content-Type': 'application/json' };
  const target = ctx.resolved.loadTargetUrl;
  const host = hostOf(target);
  const apps = (await fetchJson(`${BASE}/apps`, { headers, timeoutMs: 30000 })).json ?? [];
  const app = (Array.isArray(apps) ? apps : []).find((a) => String(a.app).replace(/^www\./, '') === host);
  if (!app) return { status: 'IMPLEMENTED_AWAITING_CREDENTIALS', summary: `target host ${host} is not registered/verified in this Loader.io account`, limitations: verificationNote, metrics: [] };
  if (app.status && !/verified/i.test(String(app.status))) return { status: 'IMPLEMENTED_AWAITING_CREDENTIALS', summary: `Loader.io target ${host} is not verified (${app.status})`, limitations: verificationNote, metrics: [] };
  const load = ctx.cfg.load?.loaderio ?? { total_clients: 1000, duration_seconds: 60 };
  const created = (await fetchJson(`${BASE}/tests`, { method: 'POST', headers, timeoutMs: 60000, retries: 1, body: JSON.stringify({ test_type: 'per-test', total: load.total_clients, duration: load.duration_seconds, timeout: 10000, error_threshold: 50, name: `goldplus-audit-${process.env.PERF_AUDIT_RUN_ID ?? 'manual'}`, urls: [{ url: target + '/', request_type: 'GET' }] }) })).json;
  const testId = created?.test_id;
  if (!testId) throw new Error(`no test_id: ${JSON.stringify(created).slice(0, 200)}`);
  const result = await pollUntil(async () => ((await fetchJson(`${BASE}/tests/${testId}/results`, { headers, timeoutMs: 30000 })).json ?? []), { done: (r) => Array.isArray(r) && r.length > 0 && /complete|finished/i.test(String(r[0].status ?? 'complete')), intervalMs: 10000, deadlineMs: (load.duration_seconds + 180) * 1000 });
  const r = result[0] ?? {};
  const total = (r.success ?? 0) + (r.error ?? 0) + (r.timeout_error ?? 0) + (r.network_error ?? 0);
  const errRate = total ? ((r.error ?? 0) + (r.timeout_error ?? 0) + (r.network_error ?? 0)) / total : null;
  const loc = 'loaderio';
  const metrics = [
    metric({ provider: 'loaderio', page: 'home', location: loc, metric: 'p50_latency_ms', value: Number.isFinite(Number(r.avg_response_time)) ? Number(r.avg_response_time) : null, unit: Number.isFinite(Number(r.avg_response_time)) ? 'ms' : 'unsupported', kind: 'load', note: 'Loader.io reports the AVERAGE response time, not a median' }),
    metric({ provider: 'loaderio', page: 'home', location: loc, metric: 'p95_latency_ms', value: null, unit: 'unsupported', kind: 'load', note: 'Loader.io API v2 results expose no percentiles' }),
    metric({ provider: 'loaderio', page: 'home', location: loc, metric: 'p99_latency_ms', value: null, unit: 'unsupported', kind: 'load' }),
    metric({ provider: 'loaderio', page: 'home', location: loc, metric: 'error_rate', value: errRate, unit: errRate === null ? 'unsupported' : 'ratio', kind: 'load' }),
    metric({ provider: 'loaderio', page: 'home', location: loc, metric: 'throughput_rps', value: total ? Math.round((total / load.duration_seconds) * 100) / 100 : null, unit: total ? 'rps' : 'unsupported', kind: 'load' }),
  ];
  ctx.save('loaderio_results.json', { test_id: testId, target, load, result: r });
  return { status: 'IMPLEMENTED_AND_VERIFIED', summary: `avg ${r.avg_response_time} ms, ${r.success} ok / ${r.error} errors / ${r.timeout_error} timeouts`, metrics, raw: { app, created, result }, refs: { test_id: testId }, limitations: 'No percentiles from Loader.io v2; only average, counts and bytes.' };
});
