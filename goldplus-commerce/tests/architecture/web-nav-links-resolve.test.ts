import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Wave 2A acceptance: all navigation routes map to real pages.
 *
 * A sidebar or card linking to a page that does not exist renders a 404 only when an
 * operator clicks it. This resolves every static internal href in the web app against
 * the file-based route table (including dynamic [param] segments and catch-alls).
 */

const WEB_SRC = path.resolve(__dirname, '../../apps/web/src');
const PAGES = path.join(WEB_SRC, 'pages');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Route patterns from the pages directory: segments, with [param]→*, [...rest]→**. */
function routePatterns(): string[][] {
  return walk(PAGES)
    .filter((f) => /\.(astro|ts)$/.test(f))
    .map((f) => {
      let rel = path.relative(PAGES, f).replace(/\.(astro|ts)$/, '');
      if (rel.endsWith('/index') || rel === 'index') rel = rel.replace(/\/?index$/, '');
      return rel === '' ? [] : rel.split('/').map((seg) => {
        if (/^\[\.\.\..+\]$/.test(seg)) return '**';
        if (/^\[.+\]$/.test(seg)) return '*';
        return seg;
      });
    });
}

function resolves(href: string, patterns: string[][]): boolean {
  const segs = href.replace(/^\//, '').split('/').filter(Boolean);
  return patterns.some((pat) => {
    if (pat.includes('**')) {
      const idx = pat.indexOf('**');
      if (segs.length < idx) return false;
      return pat.slice(0, idx).every((p, i) => p === '*' || p === segs[i]);
    }
    if (pat.length !== segs.length) return false;
    return pat.every((p, i) => p === '*' || p === segs[i]);
  });
}

describe('web navigation links resolve (Wave 2A)', () => {
  it('every static internal href maps to a real page route', () => {
    const patterns = routePatterns();
    const offenders = new Map<string, string>();
    for (const file of walk(WEB_SRC).filter((f) => /\.(astro|tsx?)$/.test(f))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/href="(\/[A-Za-z0-9_/-]*)(?:[?#][^"]*)?"/g)) {
        const href = m[1].replace(/\/+$/, '') || '/';
        if (href.startsWith('/api/')) continue; // BFF endpoints, not pages
        if (!resolves(href, patterns) && !offenders.has(href)) {
          offenders.set(href, path.relative(WEB_SRC, file));
        }
      }
    }
    const list = [...offenders.entries()].map(([h, f]) => `${h} (${f})`);
    expect(list, `dead navigation links:\n${list.join('\n')}`).toEqual([]);
  });
});
