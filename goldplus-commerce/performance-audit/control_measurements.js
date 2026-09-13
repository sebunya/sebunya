#!/usr/bin/env node
// Control measurements — our own direct evidence, used to tell APPLICATION /
// ORIGIN / CLOUDFLARE / THIRD_PARTY / TEST_NOISE apart when a provider number
// moves. Per page (home, shop, product if set): 3 GET samples via curl with
// timing, TLS version, HTTP protocol, compression, status, key response headers
// (cache-control, cf-cache-status, cf-ray, server-timing, content-encoding),
// plus a byte/request breakdown by content type from the HTML's referenced
// resources (a support measurement — not a 15th provider).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { runProvider } from './lib/provider.mjs';
import { metric, stats } from './lib/normalize.mjs';

const UA = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36 goldplus-performance-audit/control';

function curlOnce(url) {
  const fmt = '\\n__CURL__ %{http_code} %{http_version} %{ssl_verify_result} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download} %{num_redirects} %{scheme}';
  const out = execFileSync('curl', ['-sS', '-L', '--max-time', '40', '-A', UA, '-H', 'Accept-Encoding: gzip, br, zstd', '-D', '-', '-o', '/dev/null', '--write-out', fmt, url], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const [headersPart, line] = out.split('\n__CURL__ ');
  const [status, httpVersion, sslVerify, dns, connect, appconnect, starttransfer, total, bytes, redirects, scheme] = line.trim().split(' ');
  const headers = {};
  for (const h of headersPart.split(/\r?\n/)) { const i = h.indexOf(':'); if (i > 0) headers[h.slice(0, i).toLowerCase()] = h.slice(i + 1).trim(); }
  return { status: Number(status), httpVersion, sslVerify: Number(sslVerify), dns_ms: Math.round(dns * 1000), connect_ms: Math.round((connect - dns) * 1000), tls_ms: Math.round((appconnect - connect) * 1000), ttfb_ms: Math.round(starttransfer * 1000), total_ms: Math.round(total * 1000), bytes: Number(bytes), redirects: Number(redirects), scheme, headers };
}

function tlsVersion(url) {
  try { const o = execFileSync('curl', ['-sSv', '--max-time', '20', '-o', '/dev/null', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return (o.match(/SSL connection using (TLSv[\d.]+)/) || [])[1] ?? null; }
  catch (e) { const o = String(e.stderr ?? ''); return (o.match(/SSL connection using (TLSv[\d.]+)/) || [])[1] ?? null; }
}

/** Cloudflare answers non-browser clients (curl, k6, Node fetch) with a 403 challenge page. */
const isEdgeChallenge = (sample) => sample.status === 403 && (sample.headers['cf-mitigated'] !== undefined || /cloudflare/i.test(sample.headers.server ?? ''));

/** Chromium from the Playwright image (PLAYWRIGHT_BROWSERS_PATH=/ms-playwright) or CHROME_PATH. */
function findChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright';
  try { for (const d of readdirSync(root)) if (d.startsWith('chromium-') && !d.includes('headless')) { const p = `${root}/${d}/chrome-linux64/chrome`; if (existsSync(p)) return p; const q = `${root}/${d}/chrome-linux/chrome`; if (existsSync(q)) return q; } } catch { /* no browsers */ }
  return null;
}

/**
 * Browser probe: a real Chromium (the same engine a customer uses) loads the
 * page and reports Navigation Timing, paint timing, LCP, CLS, resources by
 * type with transfer sizes and the negotiated protocol. This is the control
 * measurement that reaches the site the way a visitor does, so it is the one
 * the edge cannot challenge away.
 */
async function browserProbe(pages, log) {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { return { available: false, reason: 'playwright-core is not installed' }; }
  const executablePath = findChromium();
  if (!executablePath) return { available: false, reason: 'no Chromium found (PLAYWRIGHT_BROWSERS_PATH / CHROME_PATH)' };
  let browser;
  try { browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
  catch (e) { return { available: false, reason: `Chromium launch failed: ${e.message.split('\n')[0]}` }; }
  const results = {};
  try {
    for (const [page, url] of Object.entries(pages)) {
      const samples = [];
      for (let i = 0; i < 2; i++) {
        const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36' });
        const pg = await context.newPage();
        await pg.addInitScript(() => {
          window.__gp = { lcp: null, cls: 0 };
          try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__gp.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
          try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__gp.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
        });
        let status = null;
        try {
          const resp = await pg.goto(url, { waitUntil: 'load', timeout: 45000 }); status = resp ? resp.status() : null;
          await pg.waitForTimeout(2500);
          const t = await pg.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0];
            const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
            const res = performance.getEntriesByType('resource');
            const groups = {};
            const kind = (r) => { const u = r.name.split('?')[0]; if (/\.m?js$/i.test(u) || r.initiatorType === 'script') return 'JavaScript'; if (/\.css$/i.test(u) || r.initiatorType === 'css' || r.initiatorType === 'link' && /\.css/.test(u)) return 'CSS'; if (/\.(png|jpe?g|webp|avif|gif|svg|ico)$/i.test(u) || r.initiatorType === 'img') return 'Images'; if (/\.(woff2?|ttf|otf)$/i.test(u)) return 'Fonts'; return 'Other'; };
            for (const r of res) { const g = kind(r); groups[g] = groups[g] || { requests: 0, bytes: 0 }; groups[g].requests++; groups[g].bytes += r.transferSize || 0; }
            groups.HTML = { requests: 1, bytes: nav ? nav.transferSize || 0 : 0 };
            return {
              protocol: nav ? nav.nextHopProtocol : null, ttfb_ms: nav ? nav.responseStart : null, dom_content_loaded_ms: nav ? nav.domContentLoadedEventEnd : null, load_ms: nav ? nav.loadEventEnd : null,
              fcp_ms: paints['first-contentful-paint'] ?? null, lcp_ms: window.__gp.lcp, cls: window.__gp.cls, requests: res.length + 1, total_bytes: Object.values(groups).reduce((a, g) => a + g.bytes, 0), groups,
              dom_nodes: document.getElementsByTagName('*').length,
            };
          });
          samples.push({ status, ...t });
        } catch (e) { samples.push({ status, error: e.message.split('\n')[0] }); }
        await context.close();
      }
      results[page] = { url, samples };
      log(`browser ${page}: ${samples.map((s) => `HTTP ${s.status} TTFB ${s.ttfb_ms == null ? '?' : Math.round(s.ttfb_ms)} LCP ${s.lcp_ms == null ? '?' : Math.round(s.lcp_ms)}`).join(' / ')}`);
    }
  } finally { await browser.close(); }
  return { available: true, results };
}

/** Origin probe (host runner only): the web service over the compose network, bypassing Cloudflare and Caddy. */
function originProbe(pages, targetUrl) {
  if (process.env.PERF_AUDIT_CONTAINER !== '1') return null;
  const base = process.env.PERF_AUDIT_ORIGIN_URL || 'http://web:4321';
  const host = new URL(targetUrl).host;
  const out = {};
  for (const [page, url] of Object.entries(pages)) {
    const path = new URL(url).pathname + new URL(url).search;
    const samples = [];
    for (let i = 0; i < 5; i++) {
      try {
        const fmt = '%{http_code} %{time_starttransfer} %{time_total} %{size_download}';
        const o = execFileSync('curl', ['-sS', '--max-time', '30', '-A', UA, '-H', `Host: ${host}`, '-H', 'Accept-Encoding: gzip, br', '-o', '/dev/null', '-w', fmt, `${base}${path}`], { encoding: 'utf8' });
        const [status, st, tt, bytes] = o.trim().split(' ');
        samples.push({ status: Number(status), ttfb_ms: Math.round(st * 1000), total_ms: Math.round(tt * 1000), bytes: Number(bytes) });
      } catch (e) { samples.push({ status: null, error: String(e.message).split('\n')[0] }); }
    }
    out[page] = { url: `${base}${path}`, samples };
  }
  return out;
}

runProvider('control', async (ctx) => {
  const pages = { home: `${ctx.resolved.targetUrl}/`, shop: `${ctx.resolved.targetUrl}/shop` };
  if (ctx.resolved.productUrl) pages.product = ctx.resolved.productUrl;
  const metrics = []; const raw = { edge: {}, browser: null, origin: null }; const lines = []; const limitations = [];
  const push = (page, location, name, value, unit, note, n) => metrics.push(metric({ provider: 'control', page, device: location === 'browser' ? 'mobile' : 'n/a', location, metric: name, value, unit: value === null || value === undefined ? 'unsupported' : unit, kind: 'control', note, sample_size: n }));

  // 1. Edge probe (curl): what a non-browser client sees at Cloudflare.
  const tls = tlsVersion(pages.home);
  let edgeChallenged = false;
  for (const [page, url] of Object.entries(pages)) {
    const samples = []; for (let i = 0; i < 3; i++) samples.push(curlOnce(url));
    const h = samples[0].headers; const enc = h['content-encoding'] ?? 'none';
    const challenged = samples.some(isEdgeChallenge); edgeChallenged = edgeChallenged || challenged;
    raw.edge[page] = { url, samples, tls, challenged };
    for (const k of ['cache-control', 'cf-cache-status', 'server-timing', 'content-security-policy', 'strict-transport-security', 'cf-ray', 'cf-mitigated', 'server']) raw.edge[page][k] = h[k] ?? null;
    const s = (k) => stats(samples.map((x) => x[k]));
    push(page, 'edge', 'http_status', samples[0].status, 'code', challenged ? 'Cloudflare challenge for non-browser clients (expected; see browser probe)' : null, samples.length);
    push(page, 'edge', 'connect_ms', s('connect_ms').median, 'ms', null, samples.length);
    push(page, 'edge', 'tls_handshake_ms', s('tls_ms').median, 'ms', null, samples.length);
    push(page, 'edge', 'tls_version', tls, 'label'); push(page, 'edge', 'http_protocol', samples[0].httpVersion, 'label');
    if (!challenged) {
      push(page, 'edge', 'ttfb_ms', s('ttfb_ms').median, 'ms', null, samples.length); push(page, 'edge', 'html_bytes', s('bytes').median, 'bytes', `content-encoding ${enc}`, samples.length); push(page, 'edge', 'compression', enc, 'label');
      push(page, 'edge', 'availability_pct', Math.round((samples.filter((x) => x.status === 200).length / samples.length) * 100), 'percent', null, samples.length);
    }
    lines.push(`edge ${page}: HTTP ${samples[0].status}${challenged ? ' (Cloudflare challenge for non-browser clients)' : ''}, ${samples[0].httpVersion.replace('.0', '')}, TLS ${tls}, connect ${s('connect_ms').median} ms, TLS ${s('tls_ms').median} ms${challenged ? '' : `, TTFB median ${s('ttfb_ms').median} ms, ${enc}, cf-cache ${h['cf-cache-status'] ?? '-'}`}`);
  }
  if (edgeChallenged) limitations.push('Cloudflare answers non-browser clients with a 403 challenge, so edge TTFB/bytes come from the browser probe; the curl probe still measures connect/TLS/protocol.');

  // 2. Browser probe (Chromium): the customer path — passes the edge, gives TTFB/FCP/LCP/CLS/bytes/requests.
  const bp = await browserProbe(pages, ctx.log);
  if (bp.available) {
    raw.browser = bp.results;
    for (const [page, r] of Object.entries(bp.results)) {
      const ok = r.samples.filter((x) => x.status === 200 && x.ttfb_ms != null);
      const s = (k) => stats(ok.map((x) => x[k]));
      push(page, 'browser', 'http_status', r.samples[0].status, 'code', null, r.samples.length);
      push(page, 'browser', 'availability_pct', Math.round((r.samples.filter((x) => x.status === 200).length / r.samples.length) * 100), 'percent', null, r.samples.length);
      push(page, 'browser', 'ttfb_ms', s('ttfb_ms').median == null ? null : Math.round(s('ttfb_ms').median), 'ms', 'Navigation Timing responseStart', ok.length);
      push(page, 'browser', 'fcp_ms', s('fcp_ms').median == null ? null : Math.round(s('fcp_ms').median), 'ms', null, ok.length);
      push(page, 'browser', 'lcp_ms', s('lcp_ms').median == null ? null : Math.round(s('lcp_ms').median), 'ms', 'PerformanceObserver largest-contentful-paint, 2.5 s settle; unthrottled runner network/CPU', ok.length);
      push(page, 'browser', 'cls', s('cls').median == null ? null : Math.round(s('cls').median * 1000) / 1000, 'score', null, ok.length);
      push(page, 'browser', 'requests', s('requests').median, 'count', 'performance resource entries + document', ok.length);
      push(page, 'browser', 'total_bytes', s('total_bytes').median, 'bytes', 'transferSize sum (cached/opaque resources count 0)', ok.length);
      push(page, 'browser', 'dom_nodes', s('dom_nodes').median, 'count', null, ok.length);
      push(page, 'browser', 'http_protocol', ok[0]?.protocol ?? null, 'label');
      const g = ok[0]?.groups;
      if (g) { push(page, 'browser', 'js_bytes', g.JavaScript?.bytes ?? 0, 'bytes'); push(page, 'browser', 'css_bytes', g.CSS?.bytes ?? 0, 'bytes'); push(page, 'browser', 'image_bytes', g.Images?.bytes ?? 0, 'bytes'); push(page, 'browser', 'font_bytes', g.Fonts?.bytes ?? 0, 'bytes'); push(page, 'browser', 'html_bytes', g.HTML?.bytes ?? 0, 'bytes'); }
      if (page === 'home' && g) ctx.save('pingdom_breakdown.json', { note: 'Byte/request breakdown by content type from the GoldPlus browser control probe, NOT from Pingdom (whose free tool has no API).', source: 'control/browser', page, groups: g });
      lines.push(`browser ${page}: HTTP ${r.samples[0].status}, ${ok[0]?.protocol ?? '?'}, TTFB ${s('ttfb_ms').median == null ? '?' : Math.round(s('ttfb_ms').median)} ms, FCP ${s('fcp_ms').median == null ? '?' : Math.round(s('fcp_ms').median)} ms, LCP ${s('lcp_ms').median == null ? '?' : Math.round(s('lcp_ms').median)} ms, CLS ${s('cls').median ?? '?'}, ${s('requests').median ?? '?'} requests, ${s('total_bytes').median ?? '?'} B`);
    }
  } else { limitations.push(`browser probe unavailable: ${bp.reason}`); lines.push(`browser: unavailable (${bp.reason})`); }

  // 3. Origin probe (host runner only): page generation without Cloudflare or Caddy.
  const op = originProbe(pages, ctx.resolved.targetUrl);
  if (op) {
    raw.origin = op;
    for (const [page, r] of Object.entries(op)) {
      const ok = r.samples.filter((x) => x.status === 200); const s = (k) => stats(ok.map((x) => x[k]));
      push(page, 'origin', 'http_status', r.samples[0].status, 'code', null, r.samples.length);
      push(page, 'origin', 'availability_pct', Math.round((ok.length / r.samples.length) * 100), 'percent', null, r.samples.length);
      push(page, 'origin', 'page_generation_ms', s('ttfb_ms').median, 'ms', 'TTFB of the web service over the compose network (no Cloudflare, no Caddy)', ok.length);
      push(page, 'origin', 'ttfb_ms', s('ttfb_ms').median, 'ms', null, ok.length);
      lines.push(`origin ${page}: HTTP ${r.samples[0].status}, TTFB median ${s('ttfb_ms').median ?? '?'} ms`);
    }
  }

  const anyVerified = (bp.available && Object.values(bp.results).some((r) => r.samples.some((x) => x.status === 200))) || (!edgeChallenged && Object.values(raw.edge).some((r) => r.samples.some((x) => x.status === 200)));
  return { status: anyVerified ? 'IMPLEMENTED_AND_VERIFIED' : 'PROVIDER_FAILURE', summary: lines.join(' | '), metrics, raw, limitations: limitations.length ? limitations.join(' ') : null, error: anyVerified ? null : 'no probe reached the site with HTTP 200', markdown: `# Control measurements\n\n${lines.map((l) => `- ${l}`).join('\n')}\n${limitations.length ? `\nLimitations: ${limitations.join(' ')}\n` : ''}` };
});
