#!/usr/bin/env node
// SpeedVitals — official API (verified 2026-09-13 at developers.speedvitals.com):
// base https://api.speedvitals.com, header X-API-KEY, GET /v1/ttfb-regions lists
// the regions the account may test, POST /v1/ttfb-tests { url, region } runs
// a TTFB test (credits per test; concurrency-limited). Regions are taken from
// the live list — nothing is invented; a requested region the API does not
// offer is reported as "not offered", never fabricated. Writes
// speedvitals_ttfb.csv plus min/max/mean/median.
import { runProvider, awaitingCredentials } from './lib/provider.mjs';
import { metric, stats } from './lib/normalize.mjs';
import { fetchJson, pollUntil } from './lib/http.mjs';

const BASE = 'https://api.speedvitals.com';

runProvider('speedvitals', async (ctx) => {
  const key = (ctx.env.SPEEDVITALS_API_KEY || '').trim();
  if (!key) return awaitingCredentials('SPEEDVITALS_API_KEY', 'Create an API key at speedvitals.com (API access is part of paid plans; TTFB tests cost credits) and set SPEEDVITALS_API_KEY in performance-audit/.env.');
  const headers = { 'X-API-KEY': key, 'Content-Type': 'application/json' };
  const url = ctx.resolved.targetUrl + '/';
  const regions = await fetchJson(`${BASE}/v1/ttfb-regions`, { headers, timeoutMs: 30000 });
  const offered = (regions.json?.data ?? regions.json ?? []).map((r) => (typeof r === 'string' ? { id: r, name: r } : { id: r.id ?? r.code ?? r.name, name: r.name ?? r.id, continent: r.region ?? r.continent ?? '' }));
  const wanted = ctx.cfg.speedvitals?.ttfb_regions ?? [];
  const rows = []; const metrics = []; const raw = { offered, tests: [] }; const notOffered = [];
  for (const want of wanted) {
    const region = offered.find((r) => String(r.id).toLowerCase() === String(want).toLowerCase() || String(r.name).toLowerCase().includes(String(want).toLowerCase()));
    if (!region) { notOffered.push(want); continue; }
    let ttfb = null; let status = 'ok';
    try {
      const created = await fetchJson(`${BASE}/v1/ttfb-tests`, { method: 'POST', headers, body: JSON.stringify({ url, region: region.id }), timeoutMs: 60000, retries: 2 });
      let test = created.json?.data ?? created.json;
      if (test?.id && (test.status && !/complete|success|done/i.test(String(test.status)))) {
        test = (await pollUntil(async () => (await fetchJson(`${BASE}/v1/ttfb-tests/${test.id}`, { headers, timeoutMs: 30000 })).json?.data ?? {}, { done: (t) => /complete|success|done|fail|error/i.test(String(t.status ?? 'complete')), intervalMs: 4000, deadlineMs: 180000 }));
      }
      raw.tests.push(test);
      const v = Number(test?.ttfb ?? test?.metrics?.ttfb ?? test?.result?.ttfb ?? test?.data?.ttfb);
      ttfb = Number.isFinite(v) ? v : null; if (ttfb === null) status = 'no_ttfb_field';
    } catch (e) { status = `error: ${e.message.slice(0, 80)}`; }
    rows.push({ location: region.name, region: region.id, ttfb_ms: ttfb, timestamp: new Date().toISOString(), status });
    metrics.push(metric({ provider: 'speedvitals', page: 'home', device: 'n/a', location: String(region.id), metric: 'ttfb_ms', value: ttfb, unit: ttfb === null ? 'unsupported' : 'ms', note: status === 'ok' ? null : status }));
  }
  const csv = ['location,region,ttfb_ms,timestamp,status', ...rows.map((r) => [r.location, r.region, r.ttfb_ms ?? '', r.timestamp, r.status].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n';
  ctx.save('speedvitals_ttfb.csv', csv);
  const s = stats(rows.map((r) => r.ttfb_ms));
  for (const [k, v] of Object.entries({ min: s.min, max: s.max, mean: s.mean, median: s.median })) metrics.push(metric({ provider: 'speedvitals', page: 'home', location: `aggregate:${k}`, metric: 'ttfb_ms', value: v, unit: v === null ? 'unsupported' : 'ms', sample_size: s.n }));
  const summary = `${rows.length} regions (${s.n} with TTFB): min ${s.min} / median ${s.median} / mean ${s.mean} / max ${s.max} ms${notOffered.length ? `; not offered: ${notOffered.join(', ')}` : ''}`;
  return { status: s.n > 0 ? 'IMPLEMENTED_AND_VERIFIED' : 'PROVIDER_FAILURE', summary, metrics, raw, refs: {}, limitations: notOffered.length ? `Regions not offered by SpeedVitals: ${notOffered.join(', ')}` : null, markdown: `# SpeedVitals TTFB\n\n${rows.map((r) => `- ${r.location} (${r.region}): ${r.ttfb_ms ?? 'n/a'} ms ${r.status}`).join('\n')}\n\n${summary}\n` };
});
