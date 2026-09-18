import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every seoGet/seoPost/seoPatch call in the SEO admin pages must hit a route
 * the API actually mounts. Five did not (2026-09-18): the AEO forms posted to
 * /admin/seo/aeo (no POST route), alert acknowledge/resolve, opportunity
 * dismiss and competitor classify put the id in the body or query instead of
 * the path. Each failed with "endpoint did not respond", so the screens looked
 * functional and changed nothing.
 */
const ROOT = resolve(__dirname, '../..');
const ROUTES_DIR = join(ROOT, 'apps/api/src/interfaces/http/routes');
const app = readFileSync(join(ROOT, 'apps/api/src/interfaces/http/app.ts'), 'utf8');

const imports = new Map<string, string>();
for (const m of app.matchAll(/import (\w+) from '\.\/routes\/([^']+)'/g)) imports.set(m[1], m[2]);

const routes: Array<{ method: string; rx: RegExp; example: string }> = [];
for (const m of app.matchAll(/app\.route\('([^']+)',\s*(\w+)\)/g)) {
  const file = imports.get(m[2]);
  if (!file) continue;
  let src: string;
  try { src = readFileSync(join(ROUTES_DIR, `${file}.ts`), 'utf8'); } catch { continue; }
  for (const r of src.matchAll(/routes\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    const full = (m[1].replace(/\/$/, '') + r[2]).replace(/\/$/, '') || '/';
    const rx = new RegExp('^' + full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
    routes.push({ method: r[1].toUpperCase(), rx, example: full.replace(/:[A-Za-z_]+/g, 'P') });
  }
}

const pages: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.astro')) pages.push(p);
  }
};
walk(join(ROOT, 'apps/web/src/pages/admin/seo'));

describe('SEO admin pages call routes the API mounts', () => {
  it('found the API routes and the pages', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(pages.length).toBeGreaterThan(15);
  });

  it('every write (POST/PATCH) path resolves', () => {
    const unresolved: string[] = [];
    for (const page of pages) {
      const src = readFileSync(page, 'utf8');
      for (const m of src.matchAll(/seo(Post|Patch)(?:<[^>]*>)?\(\s*token,\s*(`[^`]+`|"[^"]+")/g)) {
        const method = m[1] === 'Post' ? 'POST' : 'PATCH';
        const raw = m[2].slice(1, -1).split('?')[0];
        const path = raw.replace(/\$\{[^}]*\}/g, 'X');
        // A computed segment (\${intent}) may be any literal segment of a route.
        const pageRx = new RegExp('^' + raw.split(/\$\{[^}]*\}/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');
        if (!routes.some((r) => r.method === method && (r.rx.test(path) || pageRx.test(r.example)))) {
          unresolved.push(`${method} ${m[2]} in ${page.replace(ROOT + '/', '')}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });
});
