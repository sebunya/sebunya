#!/usr/bin/env node
/**
 * Runs lint and parses the real per-project totals out of the log rather than
 * transcribing them. Fails when aggregate errors are non-zero.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const out = process.argv[2];
let log = '';
try {
  log = execSync('pnpm lint', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  log = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}

const totals = {};
for (const m of log.matchAll(/^(\S+)\s+lint:.*?(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/gm)) {
  totals[m[1]] = { errors: Number(m[3]), warnings: Number(m[4]) };
}
const pick = (name) => totals[name] ?? { errors: 0, warnings: 0 };
const shared = pick('packages/shared');
const api = pick('apps/api');
const web = pick('apps/web');
const result = {
  sharedErrors: shared.errors, sharedWarnings: shared.warnings,
  apiErrors: api.errors, apiWarnings: api.warnings,
  webErrors: web.errors, webWarnings: web.warnings,
  aggregateErrors: shared.errors + api.errors + web.errors,
  aggregateWarnings: shared.warnings + api.warnings + web.warnings,
  policy: 'NO_REGRESSION_CEILING',
};
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.aggregateErrors !== 0) { console.error('LINT_AGGREGATE_ERRORS_NON_ZERO'); process.exit(1); }
