#!/usr/bin/env node
/**
 * Resyncs the persisted Claude release scope to the working tree.
 *
 * The verifier (verify-claude-release-scope.mjs) stays strictly read-only — a tool
 * that can both assert and rewrite its own expectation is not a verifier. This is a
 * separate, deliberately-invoked tool that reuses the verifier's own `rebuild`, so the
 * two can never drift apart.
 *
 * It is a scope-INPUT resync, not a release freeze: the scope carries no scope SHA,
 * release ID, release token, approval marker, timestamp, package head or tag, and this
 * tool never adds one. Operator-declared fields (branch, executableCommit,
 * migrationCeiling, retiredReleaseIds) are carried through untouched — a change there
 * is a human decision, never a derived one.
 *
 * Usage: resync-claude-release-scope.mjs [--check]
 */
import fs from 'node:fs';
import { SCOPE_FILE, rebuild, canonicalise, scopeSha } from './verify-claude-release-scope.mjs';

const checkOnly = process.argv.includes('--check');

const current = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
const next = rebuild(current);

// The executable commit is immutable; a resync must never silently repoint it.
if (next.executableCommit !== current.executableCommit) {
  console.error('SCOPE_RESYNC_REFUSED: executableCommit would change');
  process.exit(1);
}

const before = JSON.stringify(canonicalise(current));
const after = JSON.stringify(canonicalise(next));

if (before === after) {
  console.log('scope already in sync');
  console.log(`provisionalRailAScopeSha256=${scopeSha(next)}`);
  process.exit(0);
}

for (const k of Object.keys(next)) {
  if (JSON.stringify(canonicalise(current[k])) !== JSON.stringify(canonicalise(next[k]))) {
    console.log(`  resync: ${k}`);
  }
}

if (checkOnly) {
  console.error('SCOPE_OUT_OF_SYNC');
  process.exit(1);
}

fs.writeFileSync(SCOPE_FILE, `${JSON.stringify(next, null, 2)}\n`);
console.log(`scope resynced -> ${SCOPE_FILE}`);
console.log(`provisionalRailAScopeSha256=${scopeSha(next)}`);
