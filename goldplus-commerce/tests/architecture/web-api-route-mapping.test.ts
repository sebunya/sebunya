import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MOUNTED_API_PREFIXES } from '../../apps/api/src/interfaces/http/app';

/**
 * Wave 2A acceptance: every web API call maps to a mounted API route.
 *
 * A page calling an unmounted prefix fails only at runtime, in production, as a 404
 * the page then styles into an empty state — invisible until an operator needs it.
 * This walks every `${apiBase}/...` literal in the web app and requires a mounted
 * prefix to claim it.
 */

const WEB_SRC = path.resolve(__dirname, '../../apps/web/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Static path portion of each ${apiBase}/... template usage. */
function extractCalledPaths(): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const file of walk(WEB_SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\$\{apiBase\}\/([A-Za-z0-9_./-]+)/g)) {
      const called = `/${m[1].replace(/\/+$/, '')}`;
      const rel = path.relative(WEB_SRC, file);
      byPath.set(called, [...(byPath.get(called) ?? []), rel]);
    }
  }
  return byPath;
}

function hasMountedPrefix(calledPath: string): boolean {
  return MOUNTED_API_PREFIXES.some(
    (prefix) => calledPath === prefix || calledPath.startsWith(`${prefix}/`),
  );
}

describe('web → API route mapping (Wave 2A)', () => {
  it('every ${apiBase} call targets a mounted prefix', () => {
    const calls = extractCalledPaths();
    expect(calls.size).toBeGreaterThan(20); // extraction sanity: the platform makes many calls
    const unmounted = [...calls.entries()]
      .filter(([calledPath]) => !hasMountedPrefix(calledPath))
      .map(([calledPath, files]) => `${calledPath} (${files[0]})`);
    expect(unmounted, `web calls with no mounted API prefix:\n${unmounted.join('\n')}`).toEqual([]);
  });
});
