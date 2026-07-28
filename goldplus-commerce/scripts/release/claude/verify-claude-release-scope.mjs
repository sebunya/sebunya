#!/usr/bin/env node
/**
 * Repository verifier for the Claude canonical release scope.
 *
 * Recomputes every scope input from the working tree and compares it to the persisted
 * scope, then recomputes the scope SHA-256. Exits non-zero on any drift.
 *
 * Canonicalisation: UTF-8, recursively sorted object keys, arrays kept in their
 * deterministic order, no insignificant whitespace, no trailing newline.
 *
 * The scope deliberately contains no scope SHA, release ID, release token, approval
 * marker, timestamp, machine-specific path or release-package head, so it can never
 * become self-referential.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const SCOPE_PATH = 'docs/platform/releases/claude/CLAUDE_RELEASE_SCOPE.json';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = (p) => sha256(fs.readFileSync(p));

export const canonicalise = (value) => {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonicalise(value[k])]),
    );
  }
  return value;
};

export const scopeSha = (scope) => sha256(Buffer.from(JSON.stringify(canonicalise(scope)), 'utf8'));

const FORBIDDEN = [
  'scopeSha256',
  'releaseId',
  'releaseToken',
  'approvalMarker',
  'releasePackageHead',
  'generatedAt',
  'timestamp',
];

function rebuild(scope) {
  const migDir = 'apps/api/src/infrastructure/db/migrations';
  const migrations = fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sha256: fileSha(path.join(migDir, f)) }));

  const operatorScripts = {};
  for (const f of fs.readdirSync('scripts/release/anti-gravity').sort()) {
    operatorScripts[f] = fileSha(path.join('scripts/release/anti-gravity', f));
  }
  // Rail B operator tooling is release-bound and must be covered by the scope.
  for (const f of fs
    .readdirSync('scripts/release/claude')
    .sort()
    .filter((x) => x.endsWith('.sh') || x.endsWith('.mjs'))) {
    operatorScripts[`claude/${f}`] = fileSha(path.join('scripts/release/claude', f));
  }

  return {
    branch: scope.branch,
    executableCommit: scope.executableCommit,
    executableTree: execSync(`git rev-parse ${scope.executableCommit}^{tree}`, {
      encoding: 'utf8',
    }).trim(),
    pnpmLockSha256: fileSha('pnpm-lock.yaml'),
    apiDockerfileSha256: fileSha('Dockerfile.api'),
    webDockerfileSha256: fileSha('Dockerfile.web'),
    migrationCeiling: scope.migrationCeiling,
    migrations,
    operatorScripts,
    moduleInventorySha256: fileSha('docs/completion/CLAUDE_CURRENT_MODULE_INVENTORY.json'),
    engineeringAcceptanceSha256: fileSha('docs/completion/CLAUDE_FINAL_ENGINEERING_ACCEPTANCE.json'),
    historicSourceStatusSha256: fileSha(
      'docs/platform/evidence/releases/CLAUDE_HISTORIC_128_SOURCE_STATUS.json',
    ),
    inventoryToolingSha256: {
      build: fileSha('scripts/release/claude/build-module-inventory.mjs'),
      validate: fileSha('scripts/release/claude/validate-module-inventory.mjs'),
    },
    auditSha256: fileSha('docs/handover/claude/CLAUDE_ANTI_GRAVITY_INDEPENDENT_AUDIT.json'),
    executableBoundarySha256: fileSha(
      'docs/platform/evidence/releases/CLAUDE_EXECUTABLE_BOUNDARY.json',
    ),
    railBRunbookSha256: fileSha('docs/handover/claude/MAC_RAIL_B_RUNBOOK.json'),
    retiredReleaseIds: scope.retiredReleaseIds,
  };
}

function main() {
  const scope = JSON.parse(fs.readFileSync(SCOPE_PATH, 'utf8'));

  const leaked = FORBIDDEN.filter((k) => k in scope);
  if (leaked.length) {
    console.error(`FAIL: scope must not contain self-referential keys: ${leaked.join(', ')}`);
    process.exit(1);
  }

  const rebuilt = rebuild(scope);
  const a = JSON.stringify(canonicalise(scope));
  const b = JSON.stringify(canonicalise(rebuilt));

  if (a !== b) {
    console.error('FAIL: scope does not match the working tree.');
    for (const k of Object.keys(rebuilt)) {
      if (JSON.stringify(canonicalise(scope[k])) !== JSON.stringify(canonicalise(rebuilt[k]))) {
        console.error(`  drift: ${k}`);
      }
    }
    process.exit(1);
  }

  console.log(`scope inputs verified against working tree`);
  // Provisional: the final canonical scope can only be computed on the Mac, once
// exact image, restored-data and exact-image Playwright evidence exist.
console.log(`provisionalRailAScopeSha256=${scopeSha(scope)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
