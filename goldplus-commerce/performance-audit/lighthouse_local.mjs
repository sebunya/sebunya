#!/usr/bin/env node
// Local Lighthouse (npm lighthouse 12, pinned) run from the audit runner's own
// Chromium — the same engine and flags Lighthouse Watch uses, but with N runs
// per page and form factor and the MEDIAN reported, because a single run is
// not truth (scores vary). Mobile = simulated throttling (Moto G4-class CPU
// slowdown 4x, slow-4G network); desktop = Lighthouse's desktop preset.
// Individual runs are kept in raw.json so a 100 → 99 can be traced to the
// metric that moved. No credentials; costs ~30 s per run on the 2-vCPU host.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runProvider } from './lib/provider.mjs';
import { metric, stats } from './lib/normalize.mjs';

const require = createRequire(import.meta.url);

function findChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright';
  try { for (const d of readdirSync(root)) if (d.startsWith('chromium-') && !d.includes('headless')) for (const p of [`${root}/${d}/chrome-linux64/chrome`, `${root}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p; } catch { /* none */ }
  return null;
}

const AUDIT_NUM = ['first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'speed-index', 'interactive', 'server-response-time', 'total-byte-weight', 'bootup-time', 'mainthread-work-breakdown', 'max-potential-fid'];

function summarise(lhr) {
  const cat = (k) => (lhr.categories?.[k]?.score == null ? null : Math.round(lhr.categories[k].score * 100));
  const num = (k) => (typeof lhr.audits?.[k]?.numericValue === 'number' ? lhr.audits[k].numericValue : null);
  const items = lhr.audits?.['network-requests']?.details?.items ?? [];
  const bytesBy = (pred) => items.filter(pred).reduce((a, r) => a + (r.transferSize || 0), 0);
  const isType = (t) => (r) => (r.resourceType || '').toLowerCase() === t;
  const longTasks = lhr.audits?.['long-tasks']?.details?.items?.length ?? null;
  const firstParty = (r) => { try { return new URL(r.url).host.replace(/^www\./, '') === new URL(lhr.finalDisplayedUrl || lhr.requestedUrl).host.replace(/^www\./, ''); } catch { return true; } };
  const failing = Object.values(lhr.audits || {}).filter((a) => a.score !== null && a.score !== undefined && a.score < 1 && a.scoreDisplayMode === 'binary').map((a) => a.id).slice(0, 40);
  return {
    scores: { performance: cat('performance'), accessibility: cat('accessibility'), best_practices: cat('best-practices'), seo: cat('seo') },
    fcp_ms: num('first-contentful-paint'), lcp_ms: num('largest-contentful-paint'), cls: num('cumulative-layout-shift'), tbt_ms: num('total-blocking-time'), speed_index_ms: num('speed-index'), tti_ms: num('interactive'),
    ttfb_ms: num('server-response-time'), total_bytes: num('total-byte-weight'), js_execution_ms: num('bootup-time'), main_thread_ms: num('mainthread-work-breakdown'), max_potential_fid_ms: num('max-potential-fid'),
    requests: items.length, js_bytes: bytesBy(isType('script')), css_bytes: bytesBy(isType('stylesheet')), image_bytes: bytesBy(isType('image')), font_bytes: bytesBy(isType('font')), html_bytes: bytesBy(isType('document')),
    third_party_bytes: bytesBy((r) => !firstParty(r)), third_party_requests: items.filter((r) => !firstParty(r)).length, long_tasks: longTasks,
    // Cloudflare-injected scripts (Rocket Loader, JS detections, Web Analytics beacon) come and go per response and move
    // TBT, request count, script bytes and the best-practices "deprecations" audit. Recorded per sample so a
    // comparison never blames application code for an edge-side change.
    cloudflare_injected_requests: items.filter((r) => /\/cdn-cgi\/|cloudflareinsights\.com/.test(r.url)).length,
    cloudflare_injected_bytes: bytesBy((r) => /\/cdn-cgi\/|cloudflareinsights\.com/.test(r.url)),
    rocket_loader: items.some((r) => /rocket-loader/.test(r.url)),
    failing_audits: failing, lighthouse_version: lhr.lighthouseVersion, fetch_time: lhr.fetchTime, final_url: lhr.finalDisplayedUrl,
    numeric: Object.fromEntries(AUDIT_NUM.map((k) => [k, num(k)])),
  };
}

runProvider('lighthouse', async (ctx) => {
  let lighthouse;
  try { lighthouse = (await import('lighthouse')).default; } catch (e) { return { status: 'PROVIDER_FAILURE', error: `lighthouse package not installed: ${e.message}`, summary: 'npm install' }; }
  const chromePath = findChromium();
  if (!chromePath) return { status: 'PROVIDER_FAILURE', error: 'no Chromium found (PLAYWRIGHT_BROWSERS_PATH / CHROME_PATH)', summary: 'no browser' };
  const { launch } = require('chrome-launcher');
  const cfgL = ctx.cfg.lighthouse ?? {};
  // LIGHTHOUSE_RUNS overrides the configured count (the post-deploy smoke uses 1: a lightweight performance smoke, never a golden-master comparison).
  const runs = Math.max(1, Math.min(5, Number(process.env.LIGHTHOUSE_RUNS || cfgL.runs || 3)));
  const formFactors = Array.isArray(cfgL.form_factors) && cfgL.form_factors.length ? cfgL.form_factors : ['mobile', 'desktop'];
  const pageNames = Array.isArray(cfgL.pages) && cfgL.pages.length ? cfgL.pages : ['home', 'shop'];
  const pages = {};
  for (const n of pageNames) { if (ctx.cfg.target?.pages?.[n]) pages[n] = ctx.resolved.targetUrl + ctx.cfg.target.pages[n]; }
  if (ctx.resolved.productUrl && pageNames.includes('product')) pages.product = ctx.resolved.productUrl;
  const metrics = []; const raw = { runs_per_cell: runs, chrome: chromePath, cells: {} }; const lines = [];
  const chrome = await launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    for (const [page, url] of Object.entries(pages)) {
      for (const ff of formFactors) {
        const flags = { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] };
        const config = ff === 'desktop'
          ? { extends: 'lighthouse:default', settings: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 }, throttlingMethod: 'simulate', emulatedUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Chrome-Lighthouse' } }
          : { extends: 'lighthouse:default', settings: { formFactor: 'mobile', throttlingMethod: 'simulate' } };
        const samples = [];
        for (let i = 0; i < runs; i++) {
          try {
            const result = await lighthouse(url, flags, config);
            samples.push(summarise(result.lhr));
            ctx.log(`${page}/${ff} run ${i + 1}/${runs}: perf ${samples.at(-1).scores.performance} LCP ${Math.round(samples.at(-1).lcp_ms ?? -1)} TBT ${Math.round(samples.at(-1).tbt_ms ?? -1)}`);
          } catch (e) { samples.push({ error: String(e.message).split('\n')[0] }); ctx.log(`${page}/${ff} run ${i + 1} failed: ${String(e.message).slice(0, 120)}`); }
        }
        const ok = samples.filter((s) => !s.error);
        raw.cells[`${page}/${ff}`] = { url, samples };
        if (ok.length === 0) { lines.push(`${page}/${ff}: every run failed`); continue; }
        const med = (k) => stats(ok.map((s) => s[k])).median;
        const medScore = (k) => stats(ok.map((s) => s.scores[k])).median;
        const loc = ff === 'mobile' ? 'runner-simulated-slow4g-4xcpu' : 'runner-simulated-desktop';
        const add = (name, value, unit, note) => metrics.push(metric({ provider: 'lighthouse', page, device: ff, location: loc, metric: name, value: value == null ? null : (unit === 'score' && name !== 'cls' ? value : Math.round(value * 1000) / 1000), unit: value == null ? 'unsupported' : unit, kind: 'synthetic', note, sample_size: ok.length }));
        add('performance_score', medScore('performance'), 'score', `median of ${ok.length} runs; individual: ${ok.map((s) => s.scores.performance).join('/')}`);
        add('accessibility_score', medScore('accessibility'), 'score'); add('best_practices_score', medScore('best_practices'), 'score'); add('seo_score', medScore('seo'), 'score');
        add('fcp_ms', med('fcp_ms'), 'ms'); add('lcp_ms', med('lcp_ms'), 'ms'); add('cls', med('cls'), 'score'); add('tbt_ms', med('tbt_ms'), 'ms'); add('speed_index_ms', med('speed_index_ms'), 'ms');
        add('ttfb_ms', med('ttfb_ms'), 'ms', 'Lighthouse server-response-time'); add('total_bytes', med('total_bytes'), 'bytes'); add('js_bytes', med('js_bytes'), 'bytes'); add('css_bytes', med('css_bytes'), 'bytes');
        add('image_bytes', med('image_bytes'), 'bytes'); add('font_bytes', med('font_bytes'), 'bytes'); add('html_bytes', med('html_bytes'), 'bytes'); add('requests', med('requests'), 'count');
        add('third_party_bytes', med('third_party_bytes'), 'bytes'); add('third_party_requests', med('third_party_requests'), 'count');
        add('js_execution_ms', med('js_execution_ms'), 'ms', 'bootup-time'); add('main_thread_ms', med('main_thread_ms'), 'ms', 'mainthread-work-breakdown'); add('long_tasks', med('long_tasks'), 'count');
        add('tti_ms', med('tti_ms'), 'ms');
        add('third_party_requests', med('third_party_requests'), 'count'); metrics.push(metric({ provider: 'lighthouse', page, device: ff, location: loc, metric: 'cloudflare_injected_requests', value: med('cloudflare_injected_requests'), unit: 'count', kind: 'synthetic', note: `rocket loader per run: ${ok.map((s) => (s.rocket_loader ? 'on' : 'off')).join('/')}`, sample_size: ok.length }));
        lines.push(`${page}/${ff}: perf ${medScore('performance')} (${ok.map((s) => s.scores.performance).join('/')}; cf scripts ${ok.map((s) => s.cloudflare_injected_requests).join('/')}), a11y ${medScore('accessibility')}, bp ${medScore('best_practices')}, seo ${medScore('seo')}; LCP ${Math.round(med('lcp_ms'))} ms, TBT ${Math.round(med('tbt_ms'))} ms, CLS ${med('cls')}, SI ${Math.round(med('speed_index_ms'))} ms, ${Math.round(med('total_bytes') / 1024)} KB, ${med('requests')} req, long tasks ${med('long_tasks')}`);
      }
    }
  } finally { await chrome.kill(); }
  const anyOk = metrics.some((m) => m.value !== null);
  return {
    status: anyOk ? 'IMPLEMENTED_AND_VERIFIED' : 'PROVIDER_FAILURE', summary: lines.join(' | '), metrics, raw,
    limitations: 'Runner Chromium with Lighthouse simulated throttling: a lab number comparable run-to-run, not a field measurement. Mobile = slow-4G + 4x CPU slowdown (Moto G4 class). Medians of the configured runs; individual runs kept in raw.json.',
    markdown: `# Lighthouse (local, ${runs} runs per cell, medians)\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`,
  };
});
