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
