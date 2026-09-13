#!/usr/bin/env node
// WebPageTest — official API through the `webpagetest` npm wrapper (0.7.6, the
// package WebPageTest publishes). Verified 2026-09-13: runTest(url, {key,
// location, runs, firstViewOnly, pollResults, timeout}). API tests need an API
// key from webpagetest.org/getkey.php (paid API plans since 2022); without one
// this reports IMPLEMENTED_AWAITING_CREDENTIALS and runs nothing.
//
// Profiles: high-end desktop (Dulles:Chrome) and Moto G4-class mobile
// (Dulles_MotoG4:Chrome), 3 runs each, first + repeat view. Location ids are
// checked against the server's live location list before use.
import { createRequire } from 'node:module';
import { runProvider, awaitingCredentials } from './lib/provider.mjs';
import { metric, stats } from './lib/normalize.mjs';
import { fetchJson } from './lib/http.mjs';

const require = createRequire(import.meta.url);

runProvider('webpagetest', async (ctx) => {
  const key = (ctx.env.WPT_API_KEY || '').trim();
  if (!key) return awaitingCredentials('WPT_API_KEY', 'Create an API key at https://www.webpagetest.org/getkey.php (API access requires a WebPageTest API plan) and set WPT_API_KEY in performance-audit/.env.');
  const WebPageTest = require('webpagetest');
  const wpt = new WebPageTest(ctx.resolved.wptServer, key);
  const cfg = ctx.cfg.webpagetest;
  const url = ctx.resolved.targetUrl + '/';

  // Verify the requested locations exist on this server before submitting.
  const locs = await fetchJson(`${ctx.resolved.wptServer}/getLocations.php?f=json&k=${encodeURIComponent(key)}`, { timeoutMs: 30000 });
  const available = new Set(Object.keys(locs.json?.data ?? {}));
  const profiles = [
    { device: 'desktop', location: cfg.location_desktop },
    { device: 'mobile', location: cfg.location_mobile },
  ].map((p) => ({ ...p, ok: [...available].some((l) => p.location.startsWith(l) || l.startsWith(p.location.split(':')[0])) }));

  const runOne = (profile) => new Promise((resolveP, reject) => {
    wpt.runTest(url, { location: profile.location, runs: cfg.runs, firstViewOnly: cfg.first_view_only, pollResults: 10, timeout: Math.floor(ctx.timeoutMs / 1000 / profiles.length) - 30, lighthouse: false },
      (err, data) => (err ? reject(err) : resolveP(data)));
  });

  const metrics = []; const raw = {}; const refs = {}; const lines = [];
  for (const p of profiles) {
    if (!p.ok) { lines.push(`${p.device}: location ${p.location} not offered by ${ctx.resolved.wptServer}`); raw[p.device] = { skipped: 'location unavailable', requested: p.location }; continue; }
    const data = await runOne(p);
    raw[p.device] = data;
    const d = data?.data; if (!d) throw new Error(`no data for ${p.device}`);
    refs[p.device] = d.summary || d.id;
    for (const view of ['firstView', 'repeatView']) {
      const runs = Object.values(d.runs || {}).map((r) => r[view]).filter(Boolean);
      if (runs.length === 0) continue;
      const pick = (k) => stats(runs.map((r) => Number(r[k])).filter(Number.isFinite)).median;
      const loc = `${p.location}/${view}`;
      const add = (name, v, note) => metrics.push(metric({ provider: 'webpagetest', page: 'home', device: p.device, location: loc, metric: name, value: v ?? null, run_ref: refs[p.device], note, sample_size: runs.length }));
      add('ttfb_ms', pick('TTFB')); add('fcp_ms', pick('firstContentfulPaint')); add('lcp_ms', pick('chromeUserTiming.LargestContentfulPaint'));
      add('tbt_ms', pick('TotalBlockingTime'));
      add('cls', pick('chromeUserTiming.CumulativeLayoutShift')); add('speed_index_ms', pick('SpeedIndex')); add('visual_complete_ms', pick('visualComplete'));
      add('requests', pick('requestsFull')); add('total_bytes', pick('bytesIn'));
      lines.push(`${p.device} ${view}: TTFB ${pick('TTFB')} ms, FCP ${pick('firstContentfulPaint')} ms, LCP ${pick('chromeUserTiming.LargestContentfulPaint')} ms, TBT ${pick('TotalBlockingTime')} ms, CLS ${pick('chromeUserTiming.CumulativeLayoutShift')}, SI ${pick('SpeedIndex')} ms, requests ${pick('requestsFull')}, bytes ${pick('bytesIn')} (median of ${runs.length})`);
    }
  }
  const markdown = `# WebPageTest\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
  return { status: metrics.length ? 'IMPLEMENTED_AND_VERIFIED' : 'PROVIDER_FAILURE', summary: lines.join(' | '), metrics, raw, refs, markdown };
});
