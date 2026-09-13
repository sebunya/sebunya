#!/usr/bin/env node
// SpeedCurve — API v1 (verified 2026-09-13 at support.speedcurve.com/reference):
// base https://api.speedcurve.com/v1, HTTP Basic with the API key as username.
// Endpoints used: GET /sites (sites, monitored URLs, latest median tests),
// GET /tests/{id} (one synthetic test's details), GET /export/lux? ... RUM
// export where the account has LUX. SpeedCurve is a paid product: without
// SPEEDCURVE_API_KEY this is IMPLEMENTED_AWAITING_CREDENTIALS; with a key but
// no LUX subscription the RUM section states that bounce-rate correlation is
// unavailable from the configured data source. Nothing is correlated unless
// real session/bounce fields come back.
import { runProvider, awaitingCredentials } from './lib/provider.mjs';
import { metric } from './lib/normalize.mjs';
import { fetchJson } from './lib/http.mjs';

const BASE = 'https://api.speedcurve.com/v1';

runProvider('speedcurve', async (ctx) => {
  const key = (ctx.env.SPEEDCURVE_API_KEY || '').trim();
  if (!key) return awaitingCredentials('SPEEDCURVE_API_KEY', 'SpeedCurve is a paid subscription; the API key is under Admin → Teams. Set SPEEDCURVE_API_KEY (and optionally SPEEDCURVE_SITE_ID) in performance-audit/.env.');
  const headers = { Authorization: `Basic ${Buffer.from(`${key}:x`).toString('base64')}` };
  const sites = (await fetchJson(`${BASE}/sites`, { headers, timeoutMs: 60000 })).json;
  const list = sites?.sites ?? [];
  const wantId = ctx.resolved.speedcurveSiteId;
  const site = list.find((s) => String(s.site_id) === String(wantId)) ?? list.find((s) => JSON.stringify(s).includes('shopgoldplus')) ?? list[0];
  if (!site) return { status: 'IMPLEMENTED_AWAITING_SUBSCRIPTION', summary: 'the account has no sites', metrics: [], raw: sites };
  const metrics = []; const lines = [];
  for (const u of site.urls ?? []) {
    for (const t of u.tests ?? []) {
      const region = t.region ?? t.browser ?? 'synthetic';
      const add = (name, v, unit = 'ms') => metrics.push(metric({ provider: 'speedcurve', page: /shop\/?$/.test(u.url) ? 'shop' : 'home', device: /mobile|emulated/i.test(String(t.browser)) ? 'mobile' : 'desktop', location: String(region), metric: name, value: Number.isFinite(Number(v)) ? Number(v) : null, unit: Number.isFinite(Number(v)) ? unit : 'unsupported', kind: 'synthetic', run_ref: String(t.test_id ?? '') }));
      add('lcp_ms', t.lcp); add('cls', t.cls, 'score'); add('tbt_ms', t.tbt); add('ttfb_ms', t.byte); add('speed_index_ms', t.speedindex); add('fcp_ms', t.fcp);
      lines.push(`${u.url} [${region}/${t.browser}]: LCP ${t.lcp} ms, CLS ${t.cls}, TBT ${t.tbt} ms, TTFB ${t.byte} ms`);
    }
  }
  // LUX (RUM): the export endpoint requires a LUX subscription; a 402/403/404 is reported honestly.
  let rum = null; let rumNote = 'Bounce-rate correlation unavailable from configured data source.';
  try {
    const r = await fetchJson(`${BASE}/export/lux?site_id=${encodeURIComponent(site.site_id)}&days=7`, { headers, timeoutMs: 60000, retries: 1, expectJson: false });
    rum = { status: r.status, bytes: r.text.length, sample: r.text.slice(0, 300) };
    if (r.text.includes('bounce') || r.text.includes('session')) rumNote = 'LUX export contains session fields; analyse offline in the raw export (this run does not fabricate a correlation).';
  } catch (e) { rum = { error: e.message }; }
  const md = `# SpeedCurve\n\n${lines.map((l) => `- ${l}`).join('\n') || '- no synthetic tests returned'}\n\nRUM: ${rumNote}\n`;
  ctx.save('speedcurve_summary.md', md);
  return { status: metrics.length ? 'IMPLEMENTED_AND_VERIFIED' : 'IMPLEMENTED_AWAITING_SUBSCRIPTION', summary: lines[0] || 'no synthetic data', metrics, raw: { site, rum }, refs: { site_id: site.site_id }, limitations: rumNote, markdown: md };
});
