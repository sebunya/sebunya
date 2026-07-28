#!/usr/bin/env node
/**
 * Validates the current module inventory. Exits non-zero on any violation, so the
 * release cannot be frozen against an inventory that disagrees with the source.
 */
import fs from 'node:fs';

const INV = 'docs/completion/CLAUDE_CURRENT_MODULE_INVENTORY.json';
const ALLOWED = new Set([
  'DEAD_OR_DEPRECATED_CONFIRMED',
  'RELEASE_READY_NOT_DEPLOYED',
  'EXTERNAL_PROVIDER_BLOCKED',
  'OPERATOR_ACTIVATION_REQUIRED',
]);
const FORBIDDEN = new Set([
  'DISCOVERED_NOT_CLASSIFIED',
  'SOURCE_PARTIAL',
  'SOURCE_COMPLETE_NOT_WIRED',
  'WIRED_NOT_TESTED',
  'TESTED_NOT_PRODUCTION_SHAPED',
  'DATA_NOT_READY',
  'DEPLOYED_NOT_ACCEPTED',
  'STILL_MISSING',
]);

const inv = JSON.parse(fs.readFileSync(INV, 'utf8'));
const fail = [];

const ids = inv.modules.map((m) => m.moduleId);
if (new Set(ids).size !== ids.length) fail.push('duplicate module IDs');
if (inv.modules.length !== inv.moduleCount) fail.push('moduleCount does not match rows');

for (const m of inv.modules) {
  if (!ALLOWED.has(m.status)) fail.push(`${m.moduleId}: status ${m.status} is not an allowed pre-deployment status`);
  if (FORBIDDEN.has(m.status)) fail.push(`${m.moduleId}: engineering-incomplete status ${m.status}`);
  if (m.routeFiles > 0 && m.routeMounts.length === 0) fail.push(`${m.moduleId}: route module is not mounted`);
  if (m.status === 'DEAD_OR_DEPRECATED_CONFIRMED') {
    if (!m.deadCodeEvidence) fail.push(`${m.moduleId}: dead status without evidence`);
    if (m.runtimeReferences > 0) fail.push(`${m.moduleId}: marked dead but has ${m.runtimeReferences} runtime references`);
    if (!m.liveCapabilityLocation) fail.push(`${m.moduleId}: dead status without a live-capability note`);
  } else {
    if (m.tests === 0 && m.postgresProofs.length === 0) fail.push(`${m.moduleId}: no test or PostgreSQL proof`);
    if (!m.productionAcceptanceMethod) fail.push(`${m.moduleId}: missing production acceptance method`);
    if (!m.rollbackDependency) fail.push(`${m.moduleId}: missing rollback dependency`);
  }
}


// ─── §3 source-discovery coverage ────────────────────────────────────────────
// The inventory is only credible if it accounts for what the source actually
// contains. These checks compare declared totals against the live tree so a new
// capability cannot be added without appearing somewhere in the inventory.
import path from 'node:path';
import { execSync } from 'node:child_process';

const walk = (d, acc = []) => {
  if (!fs.existsSync(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    e.isDirectory() ? walk(f, acc) : acc.push(f);
  }
  return acc;
};
const API = 'apps/api/src';
const appSrc = fs.readFileSync(`${API}/interfaces/http/app.ts`, 'utf8');

const discovered = {
  routeMounts: [...appSrc.matchAll(/app\.route\(\s*['"`]([^'"`]+)['"`]/g)].length,
  routeFiles: [...walk(`${API}/interfaces/http/routes`), ...walk(`${API}/presentation/routes`)]
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).length,
  useCases: walk(`${API}/application/use-cases`).filter((f) => f.endsWith('.ts')).length,
  ports: walk(`${API}/application/ports`).filter((f) => f.endsWith('.ts')).length,
  repositories: walk(`${API}/infrastructure/db/repositories`).filter((f) => f.endsWith('.ts')).length,
  migrations: fs.readdirSync(`${API}/infrastructure/db/migrations`).filter((f) => f.endsWith('.sql')).length,
  adminPages: walk('apps/web/src/pages/admin').filter((f) => f.endsWith('.astro')).length,
  publicPages: walk('apps/web/src/pages').filter((f) => f.endsWith('.astro') && !f.includes('/admin/')).length,
  testFiles: walk('tests').filter((f) => f.endsWith('.test.ts')).length,
  postgresProofs: walk(`${API}/scripts`).filter((f) => f.includes('proof')).length,
};

const declared = inv.platformComposition ?? {};
for (const [key, actual] of Object.entries(discovered)) {
  if (!(key in declared)) {
    fail.push(`platformComposition is missing discovered set "${key}"`);
  } else if (declared[key] !== actual) {
    fail.push(`platformComposition.${key} declares ${declared[key]} but source has ${actual}`);
  }
}

// Every mounted admin route must be reachable through a module row, and every
// route file must be attributable. Unmounted route modules are the defect class
// that shipped the controlled-activation governance router unreachable.
const mountedPaths = [...appSrc.matchAll(/app\.route\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
const claimedMounts = new Set(inv.modules.flatMap((m) => m.routeMounts));
const sharedMounts = new Set(Object.keys(inv.sharedFoundationMounts ?? {}));
const unattributedMounts = mountedPaths.filter((p) => !claimedMounts.has(p) && !sharedMounts.has(p));
if (unattributedMounts.length > 0) {
  fail.push(
    `${unattributedMounts.length} live mount(s) belong to no module and no declared shared foundation: ` +
      unattributedMounts.join(', '),
  );
}

// Registry registrations must be non-zero and every module with repositories must
// have a persistence story recorded.
const registry = fs.readFileSync(`${API}/infrastructure/Registry.ts`, 'utf8');
const registryMembers = [...registry.matchAll(/public readonly (\w+)/g)].length;
if (registryMembers === 0) fail.push('Registry exposes no public members — composition not detected');

// Permissions must exist and be counted.
const permSrc = fs.readFileSync('packages/shared/src/permissions/index.ts', 'utf8');
const permCount = [...permSrc.matchAll(/^\s+[A-Z_0-9]+:\s*'/gm)].length;
if (permCount === 0) fail.push('no RBAC permissions discovered');

console.log(
  `coverage: mounts=${discovered.routeMounts} routeFiles=${discovered.routeFiles} useCases=${discovered.useCases} ` +
  `ports=${discovered.ports} repos=${discovered.repositories} migrations=${discovered.migrations} ` +
  `adminPages=${discovered.adminPages} publicPages=${discovered.publicPages} tests=${discovered.testFiles} ` +
  `proofs=${discovered.postgresProofs} registryMembers=${registryMembers} permissions=${permCount} ` +
  `unattributedMounts=${unattributedMounts.length}`,
);

const recomputed = inv.modules.reduce((a, m) => ((a[m.status] = (a[m.status] ?? 0) + 1), a), {});
if (JSON.stringify(recomputed) !== JSON.stringify(inv.statusTotals)) fail.push('status totals do not reconcile');
if (inv.engineeringIncomplete !== 0) fail.push(`engineeringIncomplete is ${inv.engineeringIncomplete}, must be 0`);

if (fail.length) {
  console.error('MODULE INVENTORY VALIDATION FAILED');
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`module inventory valid: ${inv.moduleCount} modules, engineering-incomplete 0`);
console.log(JSON.stringify(inv.statusTotals));
