#!/usr/bin/env node
// Submits wpt_ecommerce_flow.txt to WebPageTest (official API wrapper, `script`
// option). Needs WPT_API_KEY and AUDIT_PRODUCT_URL; stops before payment by
// construction (the script never selects a payment method or submits an order).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runProvider, awaitingCredentials } from './lib/provider.mjs';
import { metric } from './lib/normalize.mjs';
import { AUDIT_ROOT } from './lib/config.mjs';

const require = createRequire(import.meta.url);

runProvider('wpt_ecommerce_flow', async (ctx) => {
  const key = (ctx.env.WPT_API_KEY || '').trim();
  if (!key) return awaitingCredentials('WPT_API_KEY', 'Same key as webpagetest_runner.js (WebPageTest API plan).');
  if (!ctx.resolved.productUrl) return { status: 'IMPLEMENTED_AWAITING_CREDENTIALS', summary: 'AUDIT_PRODUCT_URL not set', limitations: 'Set AUDIT_PRODUCT_URL in performance-audit/.env to a product page that will stay published (see README "Test product").', metrics: [] };
  const script = readFileSync(resolve(AUDIT_ROOT, 'wpt_ecommerce_flow.txt'), 'utf8').replace(/%TARGET%/g, ctx.resolved.targetUrl).replace(/%PRODUCT_URL%/g, ctx.resolved.productUrl);
  const WebPageTest = require('webpagetest');
  const wpt = new WebPageTest(ctx.resolved.wptServer, key);
  const data = await new Promise((res, rej) => wpt.runTest(script, { location: ctx.cfg.webpagetest.location_mobile, runs: 1, firstViewOnly: true, pollResults: 10, timeout: Math.floor(ctx.timeoutMs / 1000) - 30 }, (e, d) => (e ? rej(e) : res(d))));
  const d = data?.data; if (!d) throw new Error('no data');
  const fv = d.median?.firstView ?? d.runs?.['1']?.firstView ?? {};
  const steps = Array.isArray(fv.steps) ? fv.steps : [fv];
  const metrics = []; const lines = [];
  for (const s of steps) {
    const name = s.eventName ?? 'segment';
    const add = (m, v) => metrics.push(metric({ provider: 'wpt_ecommerce_flow', page: name, device: 'mobile', location: ctx.cfg.webpagetest.location_mobile, metric: m, value: Number.isFinite(Number(v)) ? Number(v) : null, unit: Number.isFinite(Number(v)) ? (m === 'cls' ? 'score' : m.endsWith('_ms') ? 'ms' : 'count') : 'unsupported', run_ref: d.summary }));
    add('ttfb_ms', s.TTFB); add('lcp_ms', s['chromeUserTiming.LargestContentfulPaint']); add('requests', s.requestsFull); add('total_bytes', s.bytesIn);
    lines.push(`${name}: TTFB ${s.TTFB} ms, LCP ${s['chromeUserTiming.LargestContentfulPaint']} ms, ${s.requestsFull} requests, ${s.bytesIn} bytes`);
  }
  return { status: 'IMPLEMENTED_AND_VERIFIED', summary: lines.join(' | '), metrics, raw: data, refs: { summary: d.summary, id: d.id }, markdown: `# WebPageTest e-commerce flow (stops before payment)\n\n${lines.map((l) => `- ${l}`).join('\n')}\n` };
});
