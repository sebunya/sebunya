import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Wave 2A: exactly one family of modules may derive an API origin.
 *
 * measurement-control-tower.astro read `PUBLIC_API_URL` — a variable no deployment
 * sets — so production SSR fetched localhost:3000 forever and the page reported
 * SERVICE_UNAVAILABLE while returning 200. The RC-1 guard only watched
 * PUBLIC_API_BASE_URL, so the rogue variable slipped past it. This test closes both
 * holes: the rogue name is banned outright, and direct reads of the real variable are
 * restricted to the canonical clients.
 */

const WEB_SRC = path.resolve(__dirname, '../../apps/web/src');

/** The only modules allowed to touch the origin variable directly. */
const ORIGIN_READER_ALLOWLIST = new Set([
  'lib/api.ts', // canonical resolver (SSR internal / browser public)
  'lib/cartClient.ts',
  'lib/checkoutClient.ts',
  'lib/customerAuth.ts',
  'lib/telemetry.ts',
  'pages/api/admin/measurement/[...path].ts', // server-side BFF proxy
  'pages/api/rec/[...path].ts', // R2 same-origin recommendation-event relay (same canonical resolution)
  'pages/api/hero/signals.ts', // Task 3 same-origin hero-signals relay (same canonical resolution)
  'pages/api/hero/events.ts', // Task 3 same-origin hero-telemetry relay (same canonical resolution)
  'env.d.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('web API-origin allowlist (Wave 2A)', () => {
  const files = walk(WEB_SRC);

  it('PUBLIC_API_URL does not exist anywhere (nothing sets it; it silently means localhost)', () => {
    const offenders = files.filter((f) => fs.readFileSync(f, 'utf8').includes('PUBLIC_API_URL'));
    expect(offenders.map((f) => path.relative(WEB_SRC, f))).toEqual([]);
  });

  it('only canonical clients read PUBLIC_API_BASE_URL directly; pages import apiBase', () => {
    const offenders = files
      .filter((f) => fs.readFileSync(f, 'utf8').includes('PUBLIC_API_BASE_URL'))
      .map((f) => path.relative(WEB_SRC, f))
      .filter((rel) => !ORIGIN_READER_ALLOWLIST.has(rel))
      // The settings page DISPLAYS the variable's name as operator documentation.
      .filter((rel) => rel !== 'pages/admin/settings/index.astro');
    expect(offenders).toEqual([]);
  });
});
