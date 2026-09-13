#!/usr/bin/env node
// Pingdom — verified 2026-09-13: the free "Website Speed Test" at
// tools.pingdom.com is a JavaScript application with NO public API; the only
// official Pingdom API (SolarWinds, api.pingdom.com/api/3.1, bearer token) is
// for paid monitoring accounts and does not expose the free tool's per-content-
// type breakdown. Driving the free tool with a headless browser would mean
// automating a public, bot-protected web app, which this system does not do.
//
// So: with PINGDOM_API_TOKEN this reads the account's existing checks and
// their latest response times (official API, read-only); without one it
// reports BLOCKED_BY_PROVIDER for the requested Frankfurt breakdown. The
// per-content-type byte/request grouping the brief asks for is produced by the
// control measurement (lib/control_measurements.mjs) from our own page fetch,
// labelled as such — never presented as Pingdom data.
import { runProvider } from './lib/provider.mjs';
import { metric } from './lib/normalize.mjs';
import { fetchJson } from './lib/http.mjs';

runProvider('pingdom', async (ctx) => {
  const token = (ctx.env.PINGDOM_API_TOKEN || '').trim();
  const limitation = 'tools.pingdom.com (free speed test, Frankfurt) has no API and is not automated by this system. The official API 3.1 needs a paid Pingdom account and reports monitoring checks, not the free tool\'s breakdown. Set PINGDOM_API_TOKEN to read existing checks.';
  if (!token) return { status: 'BLOCKED_BY_PROVIDER', summary: 'no API for the free speed test; official API needs a paid account', limitations: limitation, metrics: [metric({ provider: 'pingdom', page: 'home', location: 'Frankfurt', metric: 'ttfb_ms', value: null, unit: 'unsupported', note: 'no automatable interface' })] };
  const headers = { Authorization: `Bearer ${token}` };
  const checks = await fetchJson('https://api.pingdom.com/api/3.1/checks?include_tags=true', { headers, timeoutMs: 30000 });
  const list = checks.json?.checks ?? [];
  const metrics = []; const lines = [];
  for (const c of list) {
    if (!/shopgoldplus/i.test(String(c.hostname ?? ''))) continue;
    metrics.push(metric({ provider: 'pingdom', page: 'site', location: String(c.probe_filters ?? 'pingdom'), metric: 'availability_pct', value: c.status === 'up' ? 100 : 0, kind: 'synthetic', run_ref: String(c.id), note: `check "${c.name}" status ${c.status}` }));
    if (Number.isFinite(Number(c.lastresponsetime))) metrics.push(metric({ provider: 'pingdom', page: 'site', location: 'pingdom', metric: 'ttfb_ms', value: Number(c.lastresponsetime), run_ref: String(c.id), note: 'last response time of the uptime check (not the speed test)' }));
    lines.push(`${c.name}: ${c.status}, last response ${c.lastresponsetime} ms`);
  }
  return { status: metrics.length ? 'IMPLEMENTED_AND_VERIFIED' : 'IMPLEMENTED_AWAITING_SUBSCRIPTION', summary: lines.join(' | ') || 'account has no checks for shopgoldplus.com', limitations: limitation, metrics, raw: checks.json, markdown: `# Pingdom (official API, monitoring checks)\n\n${lines.map((l) => `- ${l}`).join('\n') || '- no checks for this host'}\n\n${limitation}\n` };
});
