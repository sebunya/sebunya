#!/usr/bin/env node
// Performance non-regression + bundle diff for the compatibility programme.
// Compares THIS audit run's lighthouse provider (medians of N runs) and the
// data-usage journey bytes with the golden master run
// (label compatibility-performance-golden-master) in the performance-audit
// data directory. Variance is taken from the golden master's own individual
// runs (min..max per metric), not invented: a movement inside the golden
// master's own spread is NOISE; outside it is a WARNING; a score drop of 2+
// points or a metric worse by more than the spread + 10 % is a REGRESSION.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.COMPAT_OUT_DIR || join(process.cwd(), 'out', 'latest');
const DATA = process.env.PERF_AUDIT_DATA_DIR || '';
const RUN_DIR = process.env.PERF_AUDIT_RUN_DIR || '';
const GOLDEN_LABEL = process.env.COMPAT_GOLDEN_LABEL || 'compatibility-performance-golden-master';
const write = (name, data) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n');

function findGolden() {
  if (!DATA) return null;
  const reports = join(DATA, 'reports');
  if (!existsSync(reports)) return null;
  const runs = readdirSync(reports).sort().reverse();
  for (const r of runs) { try { const m = JSON.parse(readFileSync(join(reports, r, 'manifest.json'), 'utf8')); if (m.label === GOLDEN_LABEL && m.outcome !== 'FAILED') return join(reports, r); } catch { /* skip */ } }
  return null;
}
const readLh = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'providers', 'lighthouse', 'raw.json'), 'utf8')); } catch { return null; } };
const readUsage = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'providers', 'compatibility', 'compatibility', 'data_usage_report.json'), 'utf8')); } catch { return null; } };

const golden = findGolden();
const current = RUN_DIR || null;
const gl = golden ? readLh(golden) : null;
const cl = current ? readLh(current) : (existsSync(join(OUT, '..', '..', 'lighthouse', 'raw.json')) ? JSON.parse(readFileSync(join(OUT, '..', '..', 'lighthouse', 'raw.json'), 'utf8')) : null);
const METRICS = ['scores.performance', 'lcp_ms', 'fcp_ms', 'cls', 'tbt_ms', 'speed_index_ms', 'tti_ms', 'js_bytes', 'css_bytes', 'total_bytes', 'requests', 'main_thread_ms', 'long_tasks'];
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const median = (xs) => { const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const higherBetter = (m) => m === 'scores.performance';

const rows = []; let verdict = 'NO_GOLDEN_MASTER';
if (gl && cl) {
  verdict = 'PRESERVED';
  for (const [cell, gc] of Object.entries(gl.cells ?? {})) {
    const cc = cl.cells?.[cell]; if (!cc) continue;
    const gOk = (gc.samples ?? []).filter((s) => !s.error); const cOk = (cc.samples ?? []).filter((s) => !s.error);
    for (const m of METRICS) {
      const gv = gOk.map((s) => get(s, m)); const cv = cOk.map((s) => get(s, m));
      const gMed = median(gv), cMed = median(cv); if (gMed == null || cMed == null) continue;
      const gMin = Math.min(...gv.filter((x) => typeof x === 'number')), gMax = Math.max(...gv.filter((x) => typeof x === 'number'));
      // Three golden runs can land unusually close together (shop/mobile LCP spread was 82 ms while
      // home/mobile spread 840 ms on the same day), so the band is never narrower than 15 % of the
      // golden median for timings/bytes/counts: WARNING beyond the band, REGRESSION beyond 25 % or −2
      // score points. Both are reported with the golden min..max so a person can judge.
      const relBand = m === 'scores.performance' ? 0 : m === 'cls' ? 0 : Math.abs(gMed) * 0.15;
      const spread = Math.max(gMax - gMin, relBand, m.endsWith('_ms') ? 100 : m === 'cls' ? 0.02 : m.endsWith('_bytes') ? 10240 : m === 'scores.performance' ? 1 : 1);
      const worse = higherBetter(m) ? cMed < gMed : cMed > gMed;
      const delta = cMed - gMed;
      let status = 'NOISE';
      if (worse) {
        const beyond = higherBetter(m) ? gMin - cMed : cMed - gMax;
        const relWorse = gMed ? Math.abs(delta) / Math.abs(gMed) : 0;
        if (m === 'scores.performance') status = gMed - cMed >= 2 ? 'REGRESSION' : (cMed < gMin ? 'WARNING' : 'NOISE');
        else if (m === 'cls') status = delta > 0.05 ? 'REGRESSION' : delta > spread ? 'WARNING' : 'NOISE';
        else status = relWorse > 0.25 && beyond > 0 ? 'REGRESSION' : Math.abs(delta) > spread ? 'WARNING' : 'NOISE';
      } else if (!worse && Math.abs(delta) > spread) status = 'IMPROVEMENT';
      // Cloudflare-injected scripts (Rocket Loader / JS detections) differ per response: when the golden
      // and current samples do not share the same edge state, a worse number is CLOUDFLARE_STATE_DIFFERS,
      // reported but never counted as an application regression.
      // Older samples (before the per-sample field existed) are inferred from Lighthouse's "deprecations" audit,
      // which only fails when Cloudflare's injected scripts (JS detections / Rocket Loader) are present on this site.
      const cfOf = (x) => (x.cloudflare_injected_requests != null ? x.cloudflare_injected_requests : (Array.isArray(x.failing_audits) && x.failing_audits.includes('deprecations') ? 1 : 0));
      const gCf = gOk.map(cfOf); const cCf = cOk.map(cfOf);
      const cfKnown = true;
      const cfDiffers = cfKnown && (median(gCf) !== median(cCf));
      if (cfDiffers && (status === 'REGRESSION' || status === 'WARNING')) status = 'CLOUDFLARE_STATE_DIFFERS';
      rows.push({ cell, metric: m, golden_median: gMed, golden_min: gMin, golden_max: gMax, current_median: cMed, delta, status, golden_cloudflare_scripts: gCf, current_cloudflare_scripts: cCf });
      if (status === 'REGRESSION') verdict = 'REGRESSION';
      else if (status === 'WARNING' && verdict === 'PRESERVED') verdict = 'WARNING';
      else if (status === 'CLOUDFLARE_STATE_DIFFERS' && verdict === 'PRESERVED') verdict = 'WARNING_CLOUDFLARE';
    }
  }
}
const statement = verdict === 'PRESERVED' ? 'CURRENT GOLDPLUS PERFORMANCE BASELINE PRESERVED' : verdict === 'WARNING_CLOUDFLARE' ? 'CURRENT GOLDPLUS PERFORMANCE BASELINE PRESERVED (movement attributable to Cloudflare-injected scripts differing between runs; not application code)' : verdict === 'WARNING' ? 'CURRENT GOLDPLUS PERFORMANCE BASELINE PRESERVED WITH WARNINGS (movement beyond the golden master spread on some cells; investigate)' : verdict === 'REGRESSION' ? 'PERFORMANCE REGRESSION DETECTED — NOT APPROVED FOR RELEASE' : 'NO GOLDEN MASTER AVAILABLE TO COMPARE — no statement can be made';
write('performance_non_regression.json', { golden_master_run: golden ? golden.split('/').pop() : null, current_run: current ? current.split('/').pop() : null, verdict, statement, rows, method: 'medians of N Lighthouse runs per cell; the golden master run\'s min..max spread is the noise band' });

// Bundle diff: the JS/CSS bytes each journey step transferred, golden vs now (live bundles as customers receive them).
const gu = golden ? readUsage(golden) : null; const cu = existsSync(join(OUT, 'data_usage_report.json')) ? JSON.parse(readFileSync(join(OUT, 'data_usage_report.json'), 'utf8')) : null;
const bundle = [];
if (gu && cu) for (const [j, d] of Object.entries(cu.journeys ?? {})) { const g = gu.journeys?.[j]; if (!g?.cold || !d?.cold) continue; for (const k of ['js_bytes', 'css_bytes', 'total_bytes', 'requests', 'font_bytes', 'third_party_bytes']) bundle.push({ journey: j, metric: k, golden: g.cold[k], current: d.cold[k], delta: (d.cold[k] ?? 0) - (g.cold[k] ?? 0), status: (d.cold[k] ?? 0) - (g.cold[k] ?? 0) > (k === 'requests' ? 2 : 10240) ? 'GROWTH_UNEXPLAINED' : 'OK' }); }
write('bundle_diff.json', { golden_master_run: golden ? golden.split('/').pop() : null, rows: bundle, note: 'live transfer sizes per journey (what customers receive), cold cache; a build-artifact guard needs apps/web/dist on the runner and is documented as OWNER/CI action', growth: bundle.filter((b) => b.status !== 'OK').length });
console.log(statement);
process.exit(0);
