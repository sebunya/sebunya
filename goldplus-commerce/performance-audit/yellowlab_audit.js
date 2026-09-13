#!/usr/bin/env node
// Yellow Lab Tools — public API (verified 2026-09-13 on the project wiki):
// POST https://yellowlab.tools/api/runs { url, device, waitForResponse:false }
// → { runId }; GET /api/runs/{runId} → statusCode awaiting|running|complete|failed;
// GET /api/results/{runId} → rules, phantomas metrics, javascriptExecutionTree.
// No key. Fair-use limit: 12 runs / 24 h and 200 / month per IP — one run per
// audit keeps us far inside it. Uses native fetch (no axios needed).
import { runProvider } from './lib/provider.mjs';
import { metric } from './lib/normalize.mjs';
import { fetchJson, pollUntil } from './lib/http.mjs';

const BASE = 'https://yellowlab.tools/api';

runProvider('yellowlab', async (ctx) => {
  const url = ctx.resolved.targetUrl + '/';
  const device = ctx.cfg.yellowlab?.device ?? 'phone';
  const created = await fetchJson(`${BASE}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, device, waitForResponse: false, screenshot: false }), timeoutMs: 30000, retries: 1 });
  const runId = created.json?.runId;
  if (!runId) throw new Error(`no runId in response: ${JSON.stringify(created.json).slice(0, 200)}`);
  ctx.log(`run ${runId} queued`);
  const status = await pollUntil(async () => (await fetchJson(`${BASE}/runs/${runId}`, { timeoutMs: 30000 })).json, { done: (s) => ['complete', 'failed'].includes(s?.status?.statusCode ?? s?.statusCode), intervalMs: 6000, deadlineMs: ctx.timeoutMs - 60000 });
  const code = status?.status?.statusCode ?? status?.statusCode;
  if (code === 'failed') return { status: 'PROVIDER_FAILURE', summary: 'Yellow Lab run failed', raw: status, error: JSON.stringify(status).slice(0, 300) };
  const res = (await fetchJson(`${BASE}/results/${runId}`, { timeoutMs: 60000 })).json;
  const ph = res?.toolsResults?.phantomas?.metrics ?? {};
  const rules = res?.rules ?? {};
  const scores = res?.scoreProfiles?.generic ?? {};
  const g = (k) => (Number.isFinite(Number(ph[k])) ? Number(ph[k]) : null);
  const add = (name, value, unit, note) => metric({ provider: 'yellowlab', page: 'home', device, location: 'yellowlab', metric: name, value, unit: value === null ? 'unsupported' : unit, run_ref: `https://yellowlab.tools/result/${runId}`, note });
  const metrics = [
    add('dom_nodes', g('DOMelementsCount'), 'count'), add('dom_depth', g('DOMelementMaxDepth'), 'count'),
    add('requests', g('requests'), 'count'), add('total_bytes', g('bodySize') ?? g('contentLength'), 'bytes'),
    add('js_bytes', g('jsSize'), 'bytes'), add('css_bytes', g('cssSize'), 'bytes'), add('image_bytes', g('imageSize'), 'bytes'), add('html_bytes', g('htmlSize'), 'bytes'), add('font_bytes', g('webfontSize'), 'bytes'),
    add('synchronous_scripts', g('synchronousJS') ?? g('jsSync'), 'count'), add('duplicate_css_selectors', g('cssDuplicatedSelectors'), 'count'),
    add('js_execution_ms', g('DOMinteractive') === null ? null : g('DOMinteractive'), 'ms', 'phantomas DOMinteractive — the closest exposed proxy; not a CPU profile'),
    metric({ provider: 'yellowlab', page: 'home', device, location: 'yellowlab', metric: 'yellowlab_global_score', value: Number.isFinite(Number(scores.globalScore)) ? Number(scores.globalScore) : null, unit: 'score', run_ref: `https://yellowlab.tools/result/${runId}` }),
  ];
  const bottlenecks = Object.entries(rules).filter(([, r]) => r && typeof r.score === 'number' && r.score < 50).map(([k, r]) => `${k} (score ${r.score})`).slice(0, 10);
  const summary = `DOM ${g('DOMelementsCount')} nodes / depth ${g('DOMelementMaxDepth')}, ${g('requests')} requests, JS ${g('jsSize')} B, sync scripts ${g('synchronousJS') ?? g('jsSync')}, dup CSS selectors ${g('cssDuplicatedSelectors')}, global score ${scores.globalScore}`;
  ctx.save('yellowlab_report.json', { runId, url, device, generalScores: scores, phantomas: ph, weakRules: bottlenecks, rules });
  return { status: 'IMPLEMENTED_AND_VERIFIED', summary, metrics, raw: res, refs: { result: `https://yellowlab.tools/result/${runId}` }, markdown: `# Yellow Lab Tools\n\n- ${summary}\n- weakest rules: ${bottlenecks.join(', ') || 'none under 50'}\n` };
});
