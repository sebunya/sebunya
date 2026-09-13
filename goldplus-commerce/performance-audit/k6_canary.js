// k6 production CANARY — read-only, tiny, bounded: 2 VUs for 30 s against
// NOTE: variables are GP_* on purpose — k6 treats K6_VUS / K6_DURATION etc. as its own CLI options (and a bare number is milliseconds).
// GET / and GET /shop (configurable). No cart, no order, no payment, no
// cookies of value. Its job is to notice obvious degradation (5xx, p95 blow-up)
// safely; it is not the heavy test. run_k6.sh chooses this script for the
// recurring audit and the heavy script only under the dual gate.
import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET = (__ENV.GP_TARGET || '').replace(/\/+$/, '');
const HOST = __ENV.GP_HOST || ''; // set when TARGET is the origin service (http://web:4321): the Host header the app expects
const PATHS = (__ENV.GP_PATHS || '/,/shop').split(',').map((p) => p.trim()).filter(Boolean);
if (!TARGET) throw new Error('GP_TARGET is required');

export const options = {
  vus: Number(__ENV.GP_VUS || 2),
  duration: `${Number(__ENV.GP_DURATION || 30)}s`,
  thresholds: { http_req_failed: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(75)', 'p(90)', 'p(95)', 'p(99)'],
  userAgent: 'goldplus-performance-audit/k6-canary (2 VUs, read-only)',
};

export default function () {
  for (const p of PATHS) {
    const r = http.get(`${TARGET}${p}`, HOST ? { headers: { Host: HOST } } : undefined);
    check(r, { [`${p} 200`]: (x) => x.status === 200 });
    sleep(1.5);
  }
}

export function handleSummary(data) {
  const m = data.metrics;
  const v = (name, stat) => (m[name] && m[name].values && m[name].values[stat] !== undefined ? m[name].values[stat] : null);
  return {
    '/work/k6_summary.json': JSON.stringify({
      p50_ms: v('http_req_duration', 'med'), p75_ms: v('http_req_duration', 'p(75)'), p95_ms: v('http_req_duration', 'p(95)'), p99_ms: v('http_req_duration', 'p(99)'),
      error_rate: v('http_req_failed', 'rate'), requests: v('http_reqs', 'count'), rps: v('http_reqs', 'rate'), vus: options.vus, duration_s: Number(__ENV.GP_DURATION || 30),
      thresholds_passed: Object.values(m).every((x) => !x.thresholds || Object.values(x.thresholds).every((t) => t.ok)),
    }, null, 2),
    stdout: `k6 canary: p95 ${v('http_req_duration', 'p(95)')} ms, error rate ${v('http_req_failed', 'rate')}, ${v('http_reqs', 'count')} requests\n`,
  };
}
