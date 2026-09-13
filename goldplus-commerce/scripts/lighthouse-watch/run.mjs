// Runs inside the Lighthouse Watch container after the CLI has written
// <slug>.<mobile|desktop>.json files into /work. Posts every result to the
// API ingest endpoint and prints the verdict. Node 20+ (global fetch).
import { readdirSync, readFileSync } from 'node:fs';

const API = process.env.API;
const TOKEN = process.env.TOKEN;
const REASON = process.env.REASON ?? 'manual';
const files = readdirSync('/work').filter((f) => /\.(mobile|desktop)\.json$/.test(f));
if (files.length === 0) {
  console.log('lighthouse-watch: no results to post (every run failed)');
  process.exit(2);
}
const reports = [];
for (const f of files) {
  try {
    const lhr = JSON.parse(readFileSync(`/work/${f}`, 'utf8'));
    reports.push({ formFactor: f.endsWith('.desktop.json') ? 'DESKTOP' : 'MOBILE', runner: 'lighthouse-cli', lhr });
  } catch (e) {
    console.log(`lighthouse-watch: unreadable ${f}: ${String(e).slice(0, 120)}`);
  }
}
const res = await fetch(`${API}/internal/lighthouse/report`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-lighthouse-watch-token': TOKEN, 'user-agent': `goldplus-lighthouse-watch/1 (${REASON})` },
  body: JSON.stringify({ reports, collectionDate: new Date().toISOString().slice(0, 10) }),
});
const body = await res.json().catch(() => null);
if (!res.ok || !body?.success) {
  console.log(`lighthouse-watch: ingest failed HTTP ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
  process.exit(1);
}
const d = body.data;
for (const s of d.scores) console.log(`  ${s.formFactor.padEnd(7)} perf=${s.performance} a11y=${s.accessibility} bp=${s['best-practices']} seo=${s.seo}  ${s.url}`);
if (d.ok) console.log(`lighthouse-watch: ALL AT TARGET (${d.stored} results, ${d.alertsResolved} alert(s) resolved)`);
else {
  console.log(`lighthouse-watch: BELOW TARGET — ${d.shortfalls.length} cell(s); ${d.alertsRaised} alert(s) raised, ${d.alertsResolved} resolved`);
  for (const sf of d.shortfalls) console.log(`    ${sf.formFactor} ${sf.category} ${sf.score}/${sf.target} ${sf.url} [${sf.audits.join(', ')}]${sf.ownerOnly ? ' (owner action only)' : ''}`);
}
