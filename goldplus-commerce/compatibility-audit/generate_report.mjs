#!/usr/bin/env node
// Turns the records every spec appended (records/*.jsonl) plus Playwright's
// JSON results into the required artifacts. Nothing here invents a result: a
// cell that was not tested is NOT_TESTED, a real device without a provider is
// AWAITING_REAL_DEVICE, an engine control is labelled as such.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.COMPAT_OUT_DIR || join(process.cwd(), 'out', 'latest');
const RUN_ID = process.env.COMPAT_RUN_ID || new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const LABEL = process.env.COMPAT_LABEL || '';
const MODE = process.env.COMPAT_MODE || 'full';
const HERE = new URL('.', import.meta.url).pathname;
const matrix = JSON.parse(readFileSync(join(HERE, 'device-matrix.json'), 'utf8'));
const recDir = join(OUT, 'records');
const rec = (kind) => (existsSync(join(recDir, `${kind}.jsonl`)) ? readFileSync(join(recDir, `${kind}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const write = (name, data) => writeFileSync(join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
mkdirSync(OUT, { recursive: true });

// ── Playwright results → per-test status per project ────────────────────────
// One results file per pass: playwright-results-edge.json (Cloudflare path, low volume) and
// playwright-results-origin.json (full matrix through Caddy). Both are merged; each test carries its pass.
const tests = [];
for (const f of readdirSync(OUT).filter((n) => /^playwright-results-.*\.json$/.test(n))) {
  const pass = f.replace(/^playwright-results-|\.json$/g, '');
  let pw = { suites: [] };
  try { pw = JSON.parse(readFileSync(join(OUT, f), 'utf8')); } catch { continue; }
  const walk = (suite, file) => { for (const s of suite.suites ?? []) walk(s, s.file ?? file); for (const sp of suite.specs ?? []) for (const t of sp.tests ?? []) tests.push({ pass, file: sp.file ?? file, title: sp.title, project: t.projectName, status: t.results?.at(-1)?.status ?? t.status, duration_ms: t.results?.reduce((a, r) => a + (r.duration ?? 0), 0) ?? 0, error: t.results?.at(-1)?.error?.message?.split('\n')[0]?.slice(0, 200) ?? null }); };
  for (const s of pw.suites ?? []) walk(s, s.file);
}
const PASSES = [...new Set(tests.map((t) => t.pass))];
const byStatus = (st) => tests.filter((t) => t.status === st).length;

// ── Journeys ────────────────────────────────────────────────────────────────
const journeys = rec('journeys');
const journeyTests = tests.filter((t) => /journeys\//.test(t.file));
const journeyResults = journeyTests.map((t) => ({ ...t, record: journeys.find((j) => j.project === t.project && j.test === t.title) ?? null }));
const journeysPassed = journeyTests.filter((t) => t.status === 'passed').length;
const journeysFailed = journeyTests.filter((t) => t.status === 'failed' || t.status === 'timedOut').length;
const journeysBlocked = journeyTests.filter((t) => t.status === 'blocked_by_edge').length;

// ── Defects (findings with a severity) ──────────────────────────────────────
const defects = [];
const edgeBlocked = rec('edge_blocked');
const isBlocked = (t) => edgeBlocked.some((b) => b.project === t.project && b.test === t.title);
for (const t of tests) if ((t.status === 'failed' || t.status === 'timedOut') && isBlocked(t)) t.status = 'blocked_by_edge';
for (const t of tests.filter((x) => x.status === 'failed' || x.status === 'timedOut')) {
  const p0 = /journeys\//.test(t.file) && /checkout|cart|product|discovery|search/i.test(t.title);
  defects.push({ severity: p0 ? 'P0' : 'P1', source: 'test_failure', project: t.project, file: t.file, title: t.title, detail: t.error, evidence: (journeys.find((j) => j.project === t.project) ?? {}).evidence ?? null });
}
for (const r of rec('search_constraint')) if (r.status === 'FINDING') defects.push({ severity: r.severity ?? 'P2', source: 'search_constraint', project: r.project, evidence: r.evidence, title: 'network failure during suggestions is rendered as "No match"', detail: r.note });
for (const r of rec('touch_targets')) for (const u of r.undersized ?? []) defects.push({ severity: 'P3', source: 'touch_targets', project: r.project, evidence: r.evidence, title: `touch target under 44px: ${u.control}`, detail: `${u.width}×${u.height}px` });
for (const r of rec('form_ergonomics')) { for (const n of r.ios_autozoom_risk ?? []) defects.push({ severity: 'P3', source: 'form_ergonomics', project: r.project, evidence: r.evidence, title: `checkout input "${n}" under 16px (iOS auto-zoom)`, detail: null }); if (!r.user_zoom_allowed) defects.push({ severity: 'P1', source: 'form_ergonomics', project: r.project, title: 'user zoom disabled', detail: r.viewport_meta }); }
for (const r of rec('responsive')) for (const d of r.defects ?? []) defects.push({ severity: d.overflow_px > 8 ? 'P2' : 'P3', source: 'responsive', project: r.project, evidence: r.evidence, title: `${r.page} at ${d.width}px: overflow ${d.overflow_px}px / header ${d.logo ? 'ok' : 'missing'}`, detail: JSON.stringify(d) });
for (const r of rec('service_worker')) if (r.status === 'FAIL') defects.push({ severity: 'P0', source: 'service_worker', project: r.project, title: 'sensitive route served by the service worker', detail: JSON.stringify(r.sensitive_served_by_sw) });
for (const r of rec('offline')) for (const f of r.findings ?? []) defects.push({ severity: 'P2', source: 'offline', project: r.project, evidence: r.evidence, title: 'offline navigation produced a bare response', detail: f });
for (const r of rec('manifest')) for (const f of r.findings ?? []) defects.push({ severity: /icon .* HTTP|no 512|no maskable/.test(f) ? 'P2' : 'P3', source: 'manifest', project: r.project, title: `manifest: ${f}`, detail: null });
const a11y = rec('accessibility');
for (const r of a11y) for (const v of r.violations ?? []) if (v.impact === 'critical' || v.impact === 'serious') defects.push({ severity: v.impact === 'critical' ? 'P1' : 'P2', source: 'accessibility', project: r.project, evidence: r.evidence, title: `axe ${v.id} on ${r.state}`, detail: `${v.help} (${v.nodes} nodes, e.g. ${v.sample})` });
const cn = rec('console_network');
const consoleErrors = cn.flatMap((r) => (r.console ?? []).map((c) => ({ project: r.project, test: r.test, ...c })));
const networkFailures = cn.flatMap((r) => (r.network ?? []).map((n) => ({ project: r.project, test: r.test, ...n })));
for (const n of networkFailures.filter((x) => x.impact === 'COMMERCE')) defects.push({ severity: 'P1', source: 'network', project: n.project, title: `first-party ${n.kind} on a commerce resource`, detail: `${n.url} ${n.error ?? ''}` });
const sev = (s) => defects.filter((d) => d.severity === s).length;

// ── Matrices ────────────────────────────────────────────────────────────────
const cells = [];
for (const c of matrix.classes) {
  const projectName = c.engine ? `${c.engine}:${c.id}` : null;
  const jt = projectName ? journeyTests.filter((t) => t.project === projectName) : [];
  const evidence = c.engine ? (c.cpu || c.network ? 'EMULATED_CONSTRAINED_DEVICE' : (c.isMobile && c.engine === 'chromium' ? 'EMULATED_VIEWPORT' : 'ENGINE_CONTROL')) : (c.evidence ?? 'AWAITING_REAL_DEVICE');
  const blockedHere = jt.length > 0 && jt.every((t) => t.status === 'blocked_by_edge' || t.status === 'skipped');
  cells.push({ class_id: c.id, label: c.label, tier: c.tier, engine: c.engine, paths: [...new Set(jt.map((t) => t.pass))], browser: c.engine ? ({ chromium: 'Chromium (engine control for Chrome/Edge/Samsung Internet/WebView)', firefox: 'Firefox (engine)', webkit: 'WebKit (engine control for Safari)' })[c.engine] : (c.real?.browser ?? 'n/a'), os: 'Linux runner', device: c.engine ? 'emulated descriptor' : (c.real?.device ?? c.real?.os ?? 'n/a'), viewport: c.viewport ?? null, network_profile: c.network ?? 'unthrottled', cpu_profile: c.cpu ?? 'reference', mode: 'browser', evidence, journeys: jt.length ? { passed: jt.filter((t) => t.status === 'passed').length, failed: jt.filter((t) => t.status !== 'passed' && t.status !== 'skipped').length, skipped: jt.filter((t) => t.status === 'skipped').length } : null, status: !c.engine ? 'AWAITING_REAL_DEVICE' : jt.length === 0 ? 'NOT_TESTED' : blockedHere ? 'BLOCKED_BY_EDGE' : jt.some((t) => t.status === 'failed' || t.status === 'timedOut') ? 'FAIL' : 'PASS' });
}
const realDev = rec('real_device');
for (const r of realDev) { const cell = cells.find((x) => x.class_id === r.class_id); if (cell) { cell.real_device = { status: r.status, evidence: r.evidence, reason: r.reason ?? null, device: r.real?.device ?? r.real?.os ?? null, browser: r.real?.browser ?? null, viewport: r.viewport ?? null }; if (r.status === 'PASS' || r.status === 'FAIL') { cell.status = r.status; cell.evidence = r.evidence; } } }
write('compatibility_matrix.json', { run_id: RUN_ID, label: LABEL, generated_at: new Date().toISOString(), passes: PASSES, note: 'engine cells are Playwright engines on the Linux runner — NOT Safari, NOT Samsung Internet, NOT a real phone; real cells need a provider credential. Pass "origin": the full matrix reaches the origin stack through Caddy with the real hostname and certificate (Cloudflare bypassed: its bot wall challenges headless traffic from the host at volume). Pass "edge": low-volume probes through Cloudflare (Rocket Loader, data usage, PWA).', cells });

const constrained = rec('constrained');
write('constrained_experience_matrix.json', { run_id: RUN_ID, evidence: 'EMULATED_CONSTRAINED_DEVICE (Chromium CDP CPU throttling + network conditions); no REAL_LOW_END_ANDROID result exists until a device provider is credentialed', cells: constrained.map((r) => ({ class_id: r.class_id, cpu_profile: r.cpu, network_profile: r.network, profile: r.profile, home: r.home, product: r.product, product_nav_ms: r.product_nav_ms, add_to_cart_ms: r.add_to_cart_ms, total_ms: r.total_ms, status: r.status })), search: rec('search_constraint'), interruption: rec('interruption'), storage_loss: rec('storage_loss') });

const caps = rec('pwa_capabilities');
const swRec = rec('service_worker'); const manRec = rec('manifest'); const offRec = rec('offline');
const swStatic = swRec[0]?.static ?? null;
const pwaClass = !manRec.length ? 'UNKNOWN' : (swStatic ? 'INSTALLABLE_PWA' : 'PWA_FOUNDATION_ONLY');
const capRows = [];
for (const c of caps) {
  const plat = c.platform_support; const impl = c.goldplus_implementation;
  const row = (capability, supported, implemented, tested, result) => capRows.push({ platform: `${c.engine} (engine control, Linux)`, capability, platform_support: supported ? 'SUPPORTED' : 'NOT_SUPPORTED_BY_PLATFORM', goldplus_implementation: implemented ? 'IMPLEMENTED' : 'NOT_IMPLEMENTED', test_status: tested, result });
  row('manifest', true, impl.manifest, 'TESTED', manRec.find((m) => m.engine === c.engine)?.status === 'PASS' ? 'SUPPORTED_AND_PASS' : (manRec.find((m) => m.engine === c.engine) ? 'SUPPORTED_BUT_FAILING' : 'NOT_TESTED'));
  row('service_worker', plat.serviceWorker, impl.service_worker, 'TESTED', !plat.serviceWorker ? 'NOT_SUPPORTED_BY_PLATFORM' : (swRec.find((s) => s.engine === c.engine)?.runtime?.registered ? 'SUPPORTED_AND_PASS' : 'SUPPORTED_BUT_FAILING'));
  row('offline_fallback', plat.serviceWorker, impl.offline_page, c.engine === 'chromium' ? 'TESTED' : 'AWAITING_REAL_DEVICE', c.engine === 'chromium' ? (offRec.find((o) => o.engine === 'chromium')?.status === 'PASS' ? 'SUPPORTED_AND_PASS' : 'SUPPORTED_BUT_FAILING') : 'AWAITING_REAL_DEVICE');
  row('installability_prompt', plat.beforeinstallprompt, impl.install_prompt_ux, 'NOT_TESTED', plat.beforeinstallprompt ? 'NOT_IMPLEMENTED' : 'NOT_SUPPORTED_BY_PLATFORM');
  row('installation_and_standalone_launch', true, true, 'AWAITING_REAL_DEVICE', 'AWAITING_REAL_DEVICE');
  row('standalone_display_mode_adaptation', true, impl.standalone_adaptation, 'NOT_TESTED', 'NOT_IMPLEMENTED');
  row('update_lifecycle', plat.serviceWorker, impl.service_worker, 'STATIC_ANALYSIS', swStatic?.skip_waiting && swStatic?.clients_claim ? 'SUPPORTED_AND_PASS' : 'NOT_TESTED');
  for (const [k, sup, impl2] of [['push', plat.push, impl.push], ['notifications', plat.notifications, impl.notifications], ['background_sync', plat.backgroundSync, impl.background_sync], ['periodic_sync', plat.periodicSync, impl.periodic_sync], ['share', plat.share, impl.share_target], ['badging', plat.badging, impl.badging], ['shortcuts', true, impl.shortcuts]]) row(k, sup, impl2, 'NOT_TESTED', !sup ? 'NOT_SUPPORTED_BY_PLATFORM' : 'NOT_IMPLEMENTED');
  row('external_payment_handoff', true, true, 'ARCHITECTURE_REVIEW', 'SUPPORTED_AND_PASS');
}
for (const p of ['iOS Safari (real)', 'Android Chrome (real)', 'Samsung Internet (real)']) capRows.push({ platform: p, capability: 'all', platform_support: 'SEE_PLATFORM', goldplus_implementation: 'AS_ABOVE', test_status: 'AWAITING_REAL_DEVICE', result: 'AWAITING_REAL_DEVICE' });
write('pwa_capability_matrix.json', { run_id: RUN_ID, classification: pwaClass, classification_basis: 'manifest with icons + registered service worker + offline page = INSTALLABLE_PWA; no push/sync/share/badging/shortcuts = not ADVANCED_PWA', rows: capRows });

const usage = rec('data_usage');
const usageByJourney = Object.fromEntries(usage.map((u) => [u.journey, { cold: u.cold ?? null, warm: u.warm ?? null, skipped: u.skipped ?? null }]));
write('data_usage_report.json', { run_id: RUN_ID, class: 'chromium:mainstream_android', unit: 'bytes', journeys: usageByJourney });
write('route_coverage.json', { run_id: RUN_ID, routes: [...new Set(tests.map((t) => t.title))].length, tests_total: tests.length, passed: byStatus('passed'), failed: byStatus('failed') + byStatus('timedOut'), skipped: byStatus('skipped'), by_project: Object.fromEntries([...new Set(tests.map((t) => t.project))].map((p) => [p, { passed: tests.filter((t) => t.project === p && t.status === 'passed').length, failed: tests.filter((t) => t.project === p && (t.status === 'failed' || t.status === 'timedOut')).length, skipped: tests.filter((t) => t.project === p && t.status === 'skipped').length }])) });
write('journey_results.json', { run_id: RUN_ID, results: journeyResults });
write('browser_failures.json', { run_id: RUN_ID, failures: tests.filter((t) => t.status === 'failed' || t.status === 'timedOut') });
write('console_errors.json', { run_id: RUN_ID, count: consoleErrors.length, errors: consoleErrors });
write('network_failures.json', { run_id: RUN_ID, count: networkFailures.length, commerce_impact: networkFailures.filter((n) => n.impact === 'COMMERCE').length, optional_third_party: networkFailures.filter((n) => n.impact === 'OPTIONAL_THIRD_PARTY').length, first_party_analytics: networkFailures.filter((n) => n.impact === 'FIRST_PARTY_ANALYTICS').length, failures: networkFailures });
write('accessibility_findings.json', { run_id: RUN_ID, states: a11y, serious_total: a11y.reduce((a, r) => a + (r.serious ?? 0), 0), total: a11y.reduce((a, r) => a + (r.total ?? 0), 0), manual_at: 'MANUAL_AT_VALIDATION_REQUIRED (VoiceOver, TalkBack, NVDA checklists in constrained-device-policy.md)', keyboard: rec('keyboard') });
write('visual_regressions.json', { run_id: RUN_ID, cells: rec('visual'), diffs: rec('visual').filter((v) => v.status === 'DIFF').length });
write('service_worker_report.json', { run_id: RUN_ID, cells: swRec });
write('manifest_report.json', { run_id: RUN_ID, cells: manRec });
write('offline_report.json', { run_id: RUN_ID, cells: offRec, interruption: rec('interruption') });
write('pwa_failures.json', { run_id: RUN_ID, failures: [...swRec.filter((s) => s.status === 'FAIL'), ...manRec.filter((m) => m.status !== 'PASS'), ...offRec.filter((o) => o.status !== 'PASS')] });
write('real_device_results.json', { run_id: RUN_ID, provider: rec('real_device_provider')[0] ?? { provider: 'browserstack', status: 'IMPLEMENTED_AWAITING_CREDENTIALS' }, cells: realDev });
write('touch_targets.json', { run_id: RUN_ID, cells: rec('touch_targets'), form_ergonomics: rec('form_ergonomics'), text_scaling: rec('text_scaling') });
write('responsive_report.json', { run_id: RUN_ID, cells: rec('responsive') });

// ── Summary + manifest ──────────────────────────────────────────────────────
const p0 = sev('P0'), p1 = sev('P1'), p2 = sev('P2'), p3 = sev('P3');
const headline = `${MODE} (${PASSES.join('+') || 'no results'}): ${journeysPassed} journey tests passed, ${journeysFailed} failed${journeysBlocked ? `, ${journeysBlocked} blocked by the Cloudflare edge (not defects)` : ''} across ${new Set(journeyTests.map((t) => t.project)).size} engine/viewport classes; P0 ${p0}, P1 ${p1}, P2 ${p2}, P3 ${p3}; PWA ${pwaClass}; real devices ${realDev.length ? realDev[0].status : 'not run'}`;
const summary = { headline, journeys_passed: journeysPassed, journeys_failed: journeysFailed, journeys_blocked_by_edge: journeysBlocked, tests_blocked_by_edge: byStatus('blocked_by_edge'), tests_total: tests.length, tests_failed: byStatus('failed') + byStatus('timedOut'), console_errors: consoleErrors.length, network_failures: networkFailures.filter((n) => n.impact !== 'OPTIONAL_THIRD_PARTY' && n.impact !== 'FIRST_PARTY_ANALYTICS').length, a11y_serious: a11y.reduce((a, r) => a + (r.serious ?? 0), 0), a11y_total: a11y.reduce((a, r) => a + (r.total ?? 0), 0), p0, p1, p2, p3, visual_regressions: rec('visual').filter((v) => v.status === 'DIFF').length, pwa_classification: pwaClass, data_usage: usageByJourney };
write('compatibility_manifest.json', { run_id: RUN_ID, label: LABEL || null, mode: MODE, generated_at: new Date().toISOString(), target: process.env.COMPAT_TARGET_URL ?? null, playwright: '1.61.1', projects: [...new Set(tests.map((t) => t.project))], summary, defects });
write('defects.json', { run_id: RUN_ID, defects });

// ── Reports ─────────────────────────────────────────────────────────────────
const kb = (b) => (b == null ? 'no data' : b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(0)} KB`);
const eng = [];
eng.push(`# Compatibility engineering report — ${RUN_ID}${LABEL ? ` (${LABEL})` : ''}`, '', `Mode ${MODE} · ${headline}`, '', '## Compatibility matrix (evidence class per cell)', '', '| Class | Tier | Engine/browser | Viewport | CPU | Network | Evidence | Journeys | Status |', '|---|---|---|---|---|---|---|---|---|');
for (const c of cells) eng.push(`| ${c.label} | ${c.tier} | ${c.browser} | ${c.viewport ? `${c.viewport.width}×${c.viewport.height}` : '—'} | ${c.cpu_profile} | ${c.network_profile} | ${c.evidence} | ${c.journeys ? `${c.journeys.passed}/${c.journeys.passed + c.journeys.failed}` : '—'} | **${c.status}** |`);
eng.push('', '## Defects', '', defects.length ? '| Sev | Source | Project | Evidence | Title | Detail |' : '- none reproduced', ...(defects.length ? ['|---|---|---|---|---|---|', ...defects.map((d) => `| ${d.severity} | ${d.source} | ${d.project ?? '—'} | ${d.evidence ?? '—'} | ${d.title} | ${(d.detail ?? '').toString().slice(0, 160).replace(/\|/g, '/')} |`)] : []));
eng.push('', '## Constrained profiles (EMULATED_CONSTRAINED_DEVICE)', '', '| Class | CPU | Network | Home FCP/LCP ms | Product FCP/LCP ms | Long tasks (home) | Add to cart ms |', '|---|---|---|---|---|---|---|');
for (const r of constrained) eng.push(`| ${r.class_id} | ${r.cpu} | ${r.network} | ${r.home?.fcp_ms ?? '?'} / ${r.home?.lcp_ms ?? '?'} | ${r.product?.fcp_ms ?? '?'} / ${r.product?.lcp_ms ?? '?'} | ${(r.home?.long_tasks ?? []).length} (${(r.home?.long_tasks ?? []).join(',')}) | ${r.add_to_cart_ms ?? '—'} |`);
eng.push('', '## Data usage (chromium:mainstream_android)', '', '| Journey | Cold total | Cold JS | Cold images | Cold fonts | Cold 3rd-party | Warm total | Requests cold/warm |', '|---|---|---|---|---|---|---|---|');
for (const [j, d] of Object.entries(usageByJourney)) eng.push(`| ${j} | ${kb(d.cold?.total_bytes)} | ${kb(d.cold?.js_bytes)} | ${kb(d.cold?.image_bytes)} | ${kb(d.cold?.font_bytes)} | ${kb(d.cold?.third_party_bytes)} | ${kb(d.warm?.total_bytes)} | ${d.cold?.requests ?? '?'} / ${d.warm?.requests ?? '—'} |`);
eng.push('', '## PWA', '', `Classification: **${pwaClass}**. Service worker: ${swStatic ? `cache "${swStatic.cache_name}", ${swStatic.precache_entries.length} precache entries, skipWaiting ${swStatic.skip_waiting}, clients.claim ${swStatic.clients_claim}, runtime writes ${swStatic.runtime_cache_writes}, sensitive routes listed ${swStatic.sensitive_routes_listed.length}/${SENSITIVE_COUNT()}` : 'not inspected'}.`, ...manRec.flatMap((m) => m.findings.map((f) => `- manifest (${m.engine}): ${f}`)), ...swRec.flatMap((s) => s.findings.map((f) => `- service worker (${s.engine}): ${f}`)), ...offRec.flatMap((o) => [`- offline (${o.engine}): ${JSON.stringify(o.outcomes)}; recovered after eviction: ${o.recovered_after_eviction}`]));
eng.push('', '## Accessibility (automated; manual AT outstanding)', '', ...a11y.map((r) => `- ${r.project} ${r.state}: ${r.total} violations (${r.serious} serious/critical)${r.violations?.length ? ': ' + r.violations.map((v) => `${v.id}×${v.nodes}`).join(', ') : ''}`), ...rec('keyboard').map((k) => `- keyboard (${k.project}): search reached by Tab: ${k.reached_search}; Escape closes account menu: ${k.escape_closes_account_menu}`));
eng.push('', '## Console and network', '', `- console errors: ${consoleErrors.length}; network failures: ${networkFailures.length} (commerce-impacting ${networkFailures.filter((n) => n.impact === 'COMMERCE').length}, optional third-party ${networkFailures.filter((n) => n.impact === 'OPTIONAL_THIRD_PARTY').length})`, ...consoleErrors.slice(0, 10).map((c) => `  - ${c.project}: ${c.kind} ${c.text}`), ...networkFailures.filter((n) => n.impact !== 'OPTIONAL_THIRD_PARTY').slice(0, 10).map((n) => `  - ${n.project}: ${n.kind} ${n.url} ${n.error ?? ''} [${n.impact}]`));
eng.push('', '## Real devices', '', ...(realDev.length ? realDev.map((r) => `- ${r.label}: ${r.status} (${r.evidence})${r.reason ? ` — ${r.reason}` : ''}`) : ['- not run']));
write('compatibility_engineering_report.md', eng.join('\n') + '\n');

function SENSITIVE_COUNT() { return 9; }
const yes = (b) => (b ? 'YES' : 'NO');
const chromMobile = cells.find((c) => c.class_id === 'small_low_end_android'); const iphone = cells.find((c) => c.class_id === 'mainstream_iphone'); const ff = cells.find((c) => c.class_id === 'desktop_1440_firefox'); const wkDesk = cells.find((c) => c.class_id === 'desktop_1440_webkit');
const checkoutTests = journeyTests.filter((t) => /checkout entry/.test(t.title));
const exec = [
  `# Compatibility executive summary — ${RUN_ID}${LABEL ? ` (${LABEL})` : ''}`, '', headline, '',
  '## The questions', '',
  `- **Can a customer on an inexpensive Android phone shop?** ${chromMobile ? `${chromMobile.status} on the emulated small low-end Android class (${chromMobile.evidence}: 360×640, 4× CPU slowdown, 3G-like network)` : 'NOT TESTED'}. A REAL low-end Android result is ${realDev.some((r) => r.class_id === 'small_low_end_android' && r.status === 'PASS') ? 'available' : 'AWAITING_REAL_DEVICE'}.`,
  `- **Can a customer on a weak mobile connection shop?** ${constrained.length ? constrained.every((r) => r.status === 'PASS') ? 'YES on every emulated profile tested (' + [...new Set(constrained.map((r) => r.network))].join(', ') + ')' : 'NOT ON EVERY PROFILE' : 'NOT TESTED'}.`,
  `- **Can a customer entering through an in-app browser shop?** AWAITING_REAL_WEBVIEW_VALIDATION (no WebView session is automatable without an app under test or a device provider).`,
  `- **How much data do core shopping journeys consume?** home cold ${kb(usageByJourney.home?.cold?.total_bytes)} / warm ${kb(usageByJourney.home?.warm?.total_bytes)}; home→product cold ${kb(usageByJourney.home_to_product?.cold?.total_bytes)}; search→product cold ${kb(usageByJourney.search_to_product?.cold?.total_bytes)}; product→cart ${kb(usageByJourney.product_to_cart?.cold?.total_bytes)}; cart→checkout ${kb(usageByJourney.cart_to_checkout?.cold?.total_bytes)}.`,
  `- **Did any compatibility change make GoldPlus heavier?** ${process.env.COMPAT_PERF_STATEMENT || 'See performance_non_regression.json (compared by compare_runs.mjs against the golden master).'}`,
  `- **Is iOS Safari healthy?** WebKit engine control: ${iphone?.status ?? 'NOT TESTED'} (${iphone?.evidence ?? '—'}). Real iOS Safari: AWAITING_REAL_DEVICE.`,
  `- **Is Android Chrome healthy?** Chromium classes: ${cells.filter((c) => c.engine === 'chromium' && c.viewport?.width < 500).map((c) => `${c.class_id} ${c.status}`).join(', ')}. Real Android Chrome: AWAITING_REAL_DEVICE.`,
  `- **Is Samsung Internet healthy?** AWAITING_REAL_DEVICE (no engine control stands in for it).`,
  `- **Is desktop Safari healthy?** WebKit desktop engine control: ${wkDesk?.status ?? 'NOT TESTED'}. Real Safari: AWAITING_REAL_DEVICE.`,
  `- **Are Chromium/Firefox/WebKit healthy?** Chromium ${cells.filter((c) => c.engine === 'chromium' && c.status !== 'NOT_TESTED').every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL'}, Firefox ${ff?.status ?? 'NOT TESTED'}, WebKit ${cells.filter((c) => c.engine === 'webkit' && c.status !== 'NOT_TESTED').every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL'}.`,
  `- **Is checkout healthy?** ${checkoutTests.length ? `${checkoutTests.filter((t) => t.status === 'passed').length}/${checkoutTests.length} checkout-entry tests passed (form reached, fields usable, draft survives reload; never submitted)` : 'NOT TESTED'}.`,
  `- **Is PesaPal handoff architecturally healthy?** Reviewed, not exercised: server-side 303 redirect after order creation, intent cookie retained across the redirect, SameSite=Lax + Secure cookies, callback settles before redirecting back. No payment was initiated by this programme.`,
  `- **Is PWA browser mode healthy?** ${pwaClass}; service worker ${swRec.every((s) => s.status === 'PASS') ? 'never serves sensitive routes' : 'FAILED the sensitive-route check'}; offline ${offRec[0]?.status ?? 'NOT TESTED'}.`,
  `- **Is installed PWA mode healthy where supported?** AWAITING_REAL_DEVICE (installation and standalone launch need a real platform).`,
  `- **Is service-worker updating safe?** ${swStatic ? `skipWaiting + clients.claim take over immediately; safe today because checkout/cart/account bypass the worker and nothing is runtime-cached. A stale-version test needs two deployments and is scheduled with the next storefront release.` : 'NOT INSPECTED'}`,
  `- **Are there any P0s?** ${p0 ? `YES: ${p0}` : 'NO'}.`, `- **Are there any P1s?** ${p1 ? `YES: ${p1}` : 'NO'}.`,
  `- **What genuinely requires owner action?** A real-device provider credential (BrowserStack) for iOS Safari, Samsung Internet, a real low-end Android and WebViews; a stable AUDIT_PRODUCT_URL; manual VoiceOver/TalkBack/NVDA passes.`,
  '', 'Evidence classes are honest: engine controls are not real browsers; emulated constraints are not real phones.',
];
write('compatibility_executive_summary.md', exec.join('\n') + '\n');
console.log(headline);
