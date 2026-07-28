#!/usr/bin/env node
/**
 * Two independent canonicalisations of the final scope. --print uses recursive
 * key sorting; --independent uses a separately written serialiser. The finaliser
 * requires identical SHA-256 output from both.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const [scopePath, mode] = process.argv.slice(2);
const scope = JSON.parse(fs.readFileSync(scopePath, 'utf8'));

const FORBIDDEN = ['scopeSha256', 'releaseId', 'releaseToken', 'approvalMarker', 'generatedAt', 'timestamp', 'releasePackageHead', 'releaseTag'];
const leaked = FORBIDDEN.filter((k) => k in scope);
if (leaked.length) { console.error(`FINAL_SCOPE_SELF_REFERENTIAL: ${leaked.join(',')}`); process.exit(1); }

const canonA = (v) => Array.isArray(v) ? v.map(canonA)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonA(v[k])])) : v;

const canonB = (v) => {
  if (Array.isArray(v)) return '[' + v.map(canonB).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonB(v[k])).join(',') + '}';
  return JSON.stringify(v);
};

const shaA = crypto.createHash('sha256').update(Buffer.from(JSON.stringify(canonA(scope)), 'utf8')).digest('hex');
const shaB = crypto.createHash('sha256').update(Buffer.from(canonB(scope), 'utf8')).digest('hex');

if (mode === '--independent') { process.stdout.write(shaB); process.exit(0); }
if (shaA !== shaB) { console.error('FINAL_SCOPE_VERIFIER_DISAGREEMENT'); process.exit(1); }
process.stdout.write(shaA);
