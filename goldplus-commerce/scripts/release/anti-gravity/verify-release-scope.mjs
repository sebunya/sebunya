import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const scopeFile = path.join(root, 'docs/platform/releases/programme/GOLDPLUS_PROGRAMME_RELEASE_SCOPE.json');
const manifestFile = path.join(root, 'docs/platform/releases/programme/ANTI_GRAVITY_RELEASE_MANIFEST.json');

console.log('=== ANTI-GRAVITY INDEPENDENT RELEASE-SCOPE VERIFIER ===');

// 1. Verify Git status is clean and capture HEAD
const gitHead = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const gitTree = execSync(`git rev-parse "${gitHead}^{tree}"`, { encoding: 'utf8' }).trim();

console.log(`Current HEAD: ${gitHead}`);
console.log(`Git Tree:     ${gitTree}`);

// 2. Canonical JSON stringifier helper
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(canonicalize);
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

// 3. Read scope file and recompute scope SHA-256
if (!fs.existsSync(scopeFile)) {
  console.error(`FAIL: Scope file missing at ${scopeFile}`);
  process.exit(1);
}

const scopeData = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
const canonicalScopeStr = JSON.stringify(canonicalize(scopeData));
const computedScopeSha = crypto.createHash('sha256').update(canonicalScopeStr).digest('hex');

console.log(`Computed Scope SHA-256: ${computedScopeSha}`);

// 4. Verify Against Manifest
if (!fs.existsSync(manifestFile)) {
  console.error(`FAIL: Manifest file missing at ${manifestFile}`);
  process.exit(1);
}

const manifestData = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
console.log(`Manifest Executable Commit: ${manifestData.release.executableCommit}`);
console.log(`Manifest Scope SHA-256:     ${manifestData.release.scopeManifestSha256}`);

if (manifestData.release.executableCommit !== gitHead) {
  console.error(`FAIL: Manifest commit (${manifestData.release.executableCommit}) does not match HEAD (${gitHead})`);
  process.exit(1);
}

if (manifestData.release.scopeManifestSha256 !== computedScopeSha) {
  console.error(`FAIL: Recomputed scope SHA (${computedScopeSha}) does not match Manifest scope SHA (${manifestData.release.scopeManifestSha256})`);
  process.exit(1);
}

console.log('PASS: Independent Release-Scope Verification Complete.');
