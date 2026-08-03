import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * RC-1 architecture guard (do-not-break ledger #1).
 *
 * `import.meta.env.PUBLIC_API_BASE_URL` is inlined at BUILD time; when the build arg is
 * missing it becomes the EMPTY STRING, and `?? fallback` does not catch ''. The result
 * in production was a relative SSR fetch and a platform-wide "Failed to parse URL".
 * This test forbids nullish-coalescing on that variable anywhere in the web app and
 * pins the canonical resolver's SSR-internal-origin behaviour.
 */

const WEB_SRC = path.resolve(__dirname, '../../apps/web/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('SSR origin empty-safety (RC-1 guard)', () => {
  it('no file nullish-coalesces PUBLIC_API_BASE_URL (empty string slips through ??)', () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      // Flag `PUBLIC_API_BASE_URL ... ??` on one line — the exact anti-pattern that
      // shipped the empty apiBase. `||` (empty-safe) is the required form.
      if (/PUBLIC_API_BASE_URL[^\n]*\?\?/.test(text)) offenders.push(path.relative(WEB_SRC, file));
    }
    expect(offenders, `files using ?? on PUBLIC_API_BASE_URL: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the canonical resolver prefers INTERNAL_API_ORIGIN in SSR', () => {
    const api = fs.readFileSync(path.join(WEB_SRC, 'lib/api.ts'), 'utf8');
    expect(api).toMatch(/INTERNAL_API_ORIGIN/);
    expect(api).toMatch(/import\.meta\.env\.SSR/);
  });

  it('server-side proxies do not hairpin: measurement proxy prefers INTERNAL_API_ORIGIN', () => {
    const proxy = fs.readFileSync(path.join(WEB_SRC, 'pages/api/admin/measurement/[...path].ts'), 'utf8');
    expect(proxy).toMatch(/INTERNAL_API_ORIGIN/);
  });
});
