import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime domain and application code must log through the structured logger
 * (the `appLogger` port), never `console.*`. `console.*` bypasses redaction,
 * trace correlation and levels — a §10 forbidden pattern. Infrastructure keeps
 * console only where it is legitimate pre-logger bootstrap or a standalone CLI
 * (config env validation, otel init, migration/rehearsal scripts).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = path.resolve(here, '../../apps/api/src');

const SCAN_DIRS = ['domain', 'application'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('Architecture: no runtime console.* in domain/application', () => {
  it('domain and application layers use the logger port, not console.*', () => {
    const offenders: string[] = [];
    for (const d of SCAN_DIRS) {
      const dir = path.join(apiSrc, d);
      if (!fs.existsSync(dir)) continue;
      for (const file of walk(dir)) {
        const src = fs.readFileSync(file, 'utf8');
        // Match real calls: console.log/warn/error/info/debug(
        if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(src)) {
          offenders.push(path.relative(apiSrc, file));
        }
      }
    }
    expect(offenders, `console.* found in runtime domain/application — use appLogger instead: ${offenders.join(', ')}`).toEqual([]);
  });
});
