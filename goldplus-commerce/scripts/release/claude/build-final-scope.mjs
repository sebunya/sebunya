#!/usr/bin/env node
/**
 * Builds the final canonical release scope from validated evidence.
 * Excludes its own SHA, release ID/token, marker, timestamps, absolute paths,
 * the package head and the tag, so the scope can never be self-referential.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const [validationPath, outPath] = process.argv.slice(2);
if (!validationPath || !outPath) { console.error('usage: build-final-scope.mjs <validation.json> <out.json>'); process.exit(2); }
const v = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const git = (a) => execSync(`git ${a}`, { encoding: 'utf8' }).trim();

const EXEC = v.executableCandidate;
const migDir = 'apps/api/src/infrastructure/db/migrations';
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ file: f, sha256: sha(path.join(migDir, f)) }));

const scriptDir = 'scripts/release/claude';
const scripts = {};
for (const f of fs.readdirSync(scriptDir).sort()) {
  if (f.endsWith('.sh') || f.endsWith('.mjs')) scripts[f] = sha(path.join(scriptDir, f));
}

const scope = {
  targetBranch: v.targetBranch ?? 'phase-2-measurement-control-tower-completion',
  executableCommit: EXEC,
  executableTree: git(`rev-parse ${EXEC}^{tree}`),
  pnpmLockSha256: sha('pnpm-lock.yaml'),
  apiDockerfileSha256: sha('Dockerfile.api'),
  webDockerfileSha256: sha('Dockerfile.web'),
  productionComposeSha256: sha('docker-compose.production.yml'),
  caddySha256: sha('Caddyfile'),
  migrationCeiling: v.migrationCeiling,
  migrations,
  moduleInventorySha256: v.moduleInventorySha256,
  engineeringAcceptanceSha256: sha('docs/completion/CLAUDE_FINAL_ENGINEERING_ACCEPTANCE.json'),
  exactApiImageDigest: v.apiImageDigest,
  exactWebImageDigest: v.webImageDigest,
  productionBackupSha256: v.backupSha256,
  populatedUpgradeEvidenceSha256: v.populatedUpgradeEvidenceSha256 ?? null,
  oldRuntimeCompatibilityEvidenceSha256: v.oldRuntimeCompatibilityEvidenceSha256 ?? null,
  newRuntimeCanaryEvidenceSha256: v.newRuntimeCanaryEvidenceSha256 ?? null,
  exactImagePlaywrightEvidenceSha256: v.exactImagePlaywrightEvidenceSha256 ?? null,
  operatorScripts: scripts,
  runbookSha256: sha('docs/handover/claude/MAC_RAIL_B_RUNBOOK.json'),
  validationRunId: v.runId,
  retiredReleaseIds: [
    'goldplus-programme-682384b2-m0048-b79a4de7',
    'goldplus-programme-13633d86-m0048-5c6f9d25',
    'goldplus-programme-99563666-m0048-8343ee36',
    'goldplus-programme-51b86fb5-m0048-5a198e5f',
    'goldplus-programme-51cebfd6-m0048-3a467adb',
  ],
};

const FORBIDDEN = ['scopeSha256', 'releaseId', 'releaseToken', 'approvalMarker', 'generatedAt', 'timestamp', 'releasePackageHead', 'releaseTag'];
const leaked = FORBIDDEN.filter((k) => k in scope);
if (leaked.length) { console.error(`FINAL_SCOPE_SELF_REFERENTIAL: ${leaked.join(',')}`); process.exit(1); }

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(scope, null, 2) + '\n');
console.log(`final scope written: ${outPath}`);
