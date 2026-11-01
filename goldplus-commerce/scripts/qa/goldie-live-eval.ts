/**
 * Goldie live evaluation: every question in docs/ai-cx/evals/questions.json sent to the real chat endpoint,
 * each answer graded automatically. Run it after a deploy, after a prompt change, and weekly.
 *
 *   GOLDIE_EVAL_BASE=https://shopgoldplus.com INTERNAL_API_KEY=... npx tsx scripts/qa/goldie-live-eval.ts [--limit 40]
 *
 * The internal key gives each question its own fairness bucket (the month's spend cap still applies; expect a few
 * US cents for the whole set) and keeps eval turns out of the conversation archive.
 *
 * Graded per answer:
 *  - route: questions the set marks deterministic must not reach the model (X-Assistant-Route);
 *  - voice: no machine phrases, no markdown, no emoji, at most 5 sentences;
 *  - honesty: "are you a person" questions say virtual;
 *  - grounding: every UGX amount in the answer appears on a product card or link it returned.
 * Writes goldie-eval-report.json and prints the failures.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = (process.env.GOLDIE_EVAL_BASE ?? 'http://localhost:4321').replace(/\/+$/, '');
const KEY = process.env.INTERNAL_API_KEY ?? '';
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
if (KEY.length < 32) { console.error('INTERNAL_API_KEY (32+ characters) is required.'); process.exit(2); }

interface Q { id: number; group: string; text: string; intent: string; deterministic: boolean }
const set = (JSON.parse(readFileSync('docs/ai-cx/evals/questions.json', 'utf8')) as { questions: Q[] }).questions.slice(0, limit);

const MACHINE = [/as an ai/i, /i('| a)m (just )?a (bot|language model)/i, /i don'?t have feelings/i, /great question/i, /\bcertainly!/i, /\babsolutely!/i, /i'?d be happy to/i, /i hope this helps/i, /feel free to/i, /please note that/i, /rest assured/i, /apologi[sz]e for any inconvenience/i, /valued customer/i, /kindly be informed/i];
const EMOJI = /[\p{Extended_Pictographic}]/u;

async function ask(q: Q) {
  const res = await fetch(`${BASE}/api/assistant/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-goldplus-internal-key': KEY, 'x-assistant-request-id': randomUUID().replace(/-/g, '') },
    body: JSON.stringify({ messages: [{ role: 'user', content: q.text }] }),
  });
  const route = res.headers.get('x-assistant-route') ?? '';
  const raw = res.ok ? await res.text() : '';
  let text = ''; const prices: number[] = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5));
      if (ev.type === 'text') text += ev.text;
      if (ev.type === 'products') for (const p of ev.items ?? []) if (p.price_ugx != null) prices.push(Number(p.price_ugx));
    } catch { /* ignore */ }
  }
  return { status: res.status, route, text, prices };
}

function grade(q: Q, a: Awaited<ReturnType<typeof ask>>): string[] {
  const f: string[] = [];
  if (a.status !== 200) return [`HTTP ${a.status}`];
  if (!a.text.trim()) f.push('empty answer');
  if (q.deterministic && a.route === 'ai') f.push('reached the model but should have been answered from shop data');
  for (const re of MACHINE) if (re.test(a.text)) f.push(`machine phrase: ${re}`);
  if (/\*\*|^#+\s|^\s*[-*]\s/m.test(a.text)) f.push('markdown');
  if (EMOJI.test(a.text)) f.push('emoji');
  if (a.text.split(/(?<=[.?!])\s+/).filter(Boolean).length > 5) f.push('longer than 5 sentences');
  if (q.intent === 'IDENTITY' && !/virtual/i.test(a.text)) f.push('did not say it is virtual when asked');
  for (const m of a.text.matchAll(/UGX\s?([\d,]+)/g)) {
    const n = Number(m[1]!.replace(/,/g, ''));
    if (a.route === 'ai' && n > 0 && !a.prices.includes(n)) f.push(`price UGX ${n.toLocaleString()} not on any card it returned`);
  }
  return f;
}

(async () => {
  const results: Array<{ id: number; text: string; route: string; answer: string; failures: string[] }> = [];
  for (const q of set) {
    const a = await ask(q).catch((e) => ({ status: 0, route: '', text: '', prices: [] as number[], error: String(e) }));
    const failures = grade(q, a);
    results.push({ id: q.id, text: q.text, route: a.route, answer: a.text, failures });
    process.stdout.write(failures.length ? 'x' : '.');
    await new Promise((r) => setTimeout(r, 400));
  }
  const failed = results.filter((r) => r.failures.length);
  writeFileSync('goldie-eval-report.json', JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed. Report: goldie-eval-report.json`);
  for (const r of failed) console.log(`#${r.id} "${r.text}" [${r.route}]\n   ${r.failures.join('; ')}\n   > ${r.answer.slice(0, 200)}`);
  process.exit(failed.length ? 1 : 0);
})();
