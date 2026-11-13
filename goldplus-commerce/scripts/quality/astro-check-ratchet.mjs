#!/usr/bin/env node
// Type-checks the website's .astro files and fails if any file has MORE
// errors than its baseline. Plain `tsc` (pnpm typecheck) never sees .astro
// files, which is how 642 type errors built up unnoticed before 2026-11.
//
// Usage (from goldplus-commerce/):
//   node scripts/quality/astro-check-ratchet.mjs           check against the baseline
//   node scripts/quality/astro-check-ratchet.mjs --update  rewrite the baseline (only ever lower it)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = resolve(root, 'apps/web');
const baselinePath = resolve(root, 'scripts/quality/astro-check-baseline.json');

const run = spawnSync('pnpm', ['exec', 'astro', 'check'], { cwd: web, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
const out = `${run.stdout ?? ''}${run.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
const summary = out.match(/Result \(\d+ files\):\s*\n- (\d+) errors?/);
if (!summary) {
  console.error(out.slice(-4000));
  console.error('astro-check-ratchet: astro check did not produce a result summary (see output above).');
  process.exit(2);
}

/** @type {Record<string, number>} */
const now = {};
for (const m of out.matchAll(/^(src\/\S+?):\d+:\d+ - error /gm)) now[m[1]] = (now[m[1]] ?? 0) + 1;
const total = Number(summary[1]);

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(now).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify({ total, files: sorted }, null, 2)}\n`);
  console.log(`astro-check-ratchet: baseline written, ${total} errors in ${Object.keys(sorted).length} files.`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(baselinePath, 'utf8'));
const worse = Object.entries(now).filter(([f, n]) => n > (base.files[f] ?? 0));
const better = Object.entries(base.files).filter(([f, n]) => (now[f] ?? 0) < n);

if (worse.length) {
  console.error(out.split('\n').filter((l) => worse.some(([f]) => l.startsWith(`${f}:`))).join('\n'));
  console.error('\nastro-check-ratchet: new type errors in .astro files:');
  for (const [f, n] of worse) console.error(`  ${f}: ${n} (baseline ${base.files[f] ?? 0})`);
  process.exit(1);
}
console.log(`astro-check-ratchet: ${total} errors, none above the baseline (${base.total}).`);
if (better.length) console.log(`  ${better.length} file(s) improved; lower the baseline with --update.`);
