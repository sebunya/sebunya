import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The storefront must never make a server-side request to its own public edge.
 *
 * WHY THIS EXISTS
 * `checkoutClient.ts`, `cartClient.ts` and `customerAuth.ts` each resolved
 * PUBLIC_API_BASE_URL themselves. All three are called from Astro frontmatter,
 * so on the server they left the container, hit Cloudflare, and were answered
 * with a 403 "Just a moment..." challenge page instead of JSON. Checkout could
 * not create a single order; the cart's server writes were refused; signed-in
 * shoppers were silently downgraded to guests. The rule was already written in
 * apps/web/src/lib/api.ts — nothing enforced it.
 *
 * The rule: one resolver. `apiBase` (internal during SSR, public in the
 * browser) for anything a server may call; `publicApiBase` only for values
 * serialised into HTML for the browser.
 */

const root = resolve(__dirname, '../..');
const webSrc = resolve(root, 'apps/web/src');
const read = (file: string) => readFileSync(file, 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sourceFiles = walk(webSrc).filter((f) => /\.(ts|astro)$/.test(f));

/** api.ts is the resolver itself; telemetry.ts is browser-only (it reads window). */
const RESOLVER_EXEMPT = new Set(['apps/web/src/lib/api.ts', 'apps/web/src/lib/telemetry.ts']);

describe('SSR never hairpins through the public edge', () => {
  it('never builds a request origin from the public URL alone', () => {
    // The defect is resolving the PUBLIC origin with NO internal branch: on the
    // server that address goes out to the edge. The relays under pages/api/*
    // are correct — they read INTERNAL_API_ORIGIN first and fall back to public
    // only for local development — so the rule is "public without internal",
    // not "mentions public". Reading the value to DISPLAY it (the settings
    // page) is fine too, hence the assignment-shaped match.
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = relative(root, file);
      if (RESOLVER_EXEMPT.has(rel)) continue;
      const src = read(file);
      const assignment = src.match(/(?:const|let|var)\s+\w*(?:API_BASE|apiBase|BASE_URL)\w*\s*=[\s\S]{0,400}?PUBLIC_API_BASE_URL[\s\S]{0,200}?;/);
      if (assignment && !/INTERNAL_API_ORIGIN/.test(assignment[0])) offenders.push(rel);
    }
    expect(offenders, `these resolve the public origin with no internal branch: ${offenders.join(', ')}`).toEqual([]);
  });

  it('never fetches its own public origin from the server', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = read(file);
      // A server-side fetch built from the incoming request's own origin goes
      // out to the edge and back. Call the API directly instead.
      if (/fetch\(\s*`\$\{\s*(?:new URL\(Astro\.request\.url\)\.origin|Astro\.url\.origin|Astro\.site)/.test(src)) {
        offenders.push(relative(root, file));
      }
    }
    expect(offenders, `these fetch their own public origin server-side: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps the three clients that broke checkout on the canonical resolver', () => {
    for (const rel of ['apps/web/src/lib/checkoutClient.ts', 'apps/web/src/lib/cartClient.ts', 'apps/web/src/lib/customerAuth.ts']) {
      const src = read(resolve(root, rel));
      expect(src, `${rel} must import the canonical origin`).toMatch(/import \{[^}]*\bapiBase\b[^}]*\} from '\.\/api'/);
      expect(src, `${rel} must not resolve the public origin itself`).not.toMatch(/API_BASE\s*=\s*\(?\s*import\.meta\.env\.PUBLIC_API_BASE_URL/);
    }
  });

  it('states the rule where a reader will find it', () => {
    const api = read(resolve(root, 'apps/web/src/lib/api.ts'));
    expect(api).toMatch(/never hairpin SSR through the public edge/i);
    expect(api).toMatch(/INTERNAL_API_ORIGIN/);
  });
});
