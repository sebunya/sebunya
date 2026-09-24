import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * Recorded redirects (U6 AC6) never fired: every storefront route that 404s
 * does `return Astro.redirect('/404', 404)`, and Astro keeps that 404 status
 * when 404.astro answers with its own 301, merging the two Location headers.
 * The shopper on an old product link got HTTP 404, a blank body and
 * `location: <target>, /404`. The route must ask BEFORE handing over.
 */

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('findRecordedRedirect — the lookup a route makes before it 404s', () => {
  it('returns the recorded target and a 301 for a slug-change row', async () => {
    const { findRecordedRedirect } = await import('../../apps/web/src/lib/recordedRedirect');
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      return jsonResponse(200, { success: true, data: { to: '/products/gp-x03-20000mah', statusCode: 301 } });
    };
    const hit = await findRecordedRedirect('/products/gp-x03', { fetchImpl, base: 'http://api:3000' });
    expect(hit).toEqual({ target: '/products/gp-x03-20000mah', status: 301 });
    expect(seen).toEqual(['http://api:3000/seo/resolve-redirect?path=%2Fproducts%2Fgp-x03']);
  });

  it('keeps a recorded 302 as a 302 and treats anything else as a 301', async () => {
    const { findRecordedRedirect } = await import('../../apps/web/src/lib/recordedRedirect');
    const temp = await findRecordedRedirect('/old-page', {
      fetchImpl: async () => jsonResponse(200, { success: true, data: { to: '/shop', statusCode: 302 } }),
    });
    expect(temp).toEqual({ target: '/shop', status: 302 });
    const odd = await findRecordedRedirect('/old-page', {
      fetchImpl: async () => jsonResponse(200, { success: true, data: { to: '/shop', statusCode: 308 } }),
    });
    expect(odd).toEqual({ target: '/shop', status: 301 });
  });

  it('refuses a target that leaves the site or loops back to itself', async () => {
    const { findRecordedRedirect } = await import('../../apps/web/src/lib/recordedRedirect');
    for (const to of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/old-page']) {
      const hit = await findRecordedRedirect('/old-page', {
        fetchImpl: async () => jsonResponse(200, { success: true, data: { to, statusCode: 301 } }),
      });
      expect(hit, to).toBeNull();
    }
  });

  it('fails open: a miss, an API error, a thrown fetch or /404 itself all give null', async () => {
    const { findRecordedRedirect } = await import('../../apps/web/src/lib/recordedRedirect');
    expect(await findRecordedRedirect('/nothing', { fetchImpl: async () => jsonResponse(404, { success: false }) })).toBeNull();
    expect(await findRecordedRedirect('/nothing', { fetchImpl: async () => new Response('<html>', { status: 200 }) })).toBeNull();
    expect(await findRecordedRedirect('/nothing', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } })).toBeNull();
    const never = vi.fn();
    expect(await findRecordedRedirect('/404', { fetchImpl: never as any })).toBeNull();
    expect(await findRecordedRedirect('', { fetchImpl: never as any })).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});

describe('the routes that 404 ask for a recorded redirect first', () => {
  it('[hub]/[...child].astro redirects to a recorded target before returning its 404', () => {
    const src = read('apps/web/src/pages/[hub]/[...child].astro');
    const lookup = src.indexOf('await findRecordedRedirect(Astro.url.pathname)');
    const notFound = src.indexOf("return Astro.redirect('/404', 404)");
    expect(lookup).toBeGreaterThan(0);
    expect(notFound).toBeGreaterThan(lookup);
    expect(src).toMatch(/if \(recorded\) return Astro\.redirect\(recorded\.target, recorded\.status\);/);
  });

  it('products/[slug].astro (slug changes) asks before EVERY 404 it returns, and never on the 503', () => {
    const src = read('apps/web/src/pages/products/[slug].astro');
    expect(src).toContain("import { findRecordedRedirect } from '../../lib/recordedRedirect';");
    const notFound = "return Astro.redirect('/404', 404)";
    const lookup = 'await findRecordedRedirect(Astro.url.pathname)';
    let at = src.indexOf(notFound);
    let count = 0;
    while (at !== -1) {
      count += 1;
      // The lookup and its redirect sit directly before this 404, in the same block.
      const before = src.slice(Math.max(0, at - 200), at);
      expect(before).toContain(lookup);
      expect(before).toMatch(/if \(recorded\) return Astro\.redirect\(recorded\.target, recorded\.status\);\s*$/);
      at = src.indexOf(notFound, at + 1);
    }
    expect(count).toBe(2);
    // An unreachable API is not a missing product: the 503 answers alone.
    const unavailable = src.slice(src.indexOf('if (fetchError) {'), src.indexOf('status: 503'));
    expect(unavailable).not.toContain('findRecordedRedirect');
  });
});

// ── recordSlugChange collapses chains (A→B then B→C sends A straight to C) ──

type Op = { op: 'delete' | 'update' | 'insert'; where?: { sql: string; params: unknown[] }; set?: Record<string, unknown>; values?: Record<string, unknown> };
const ops: Op[] = [];
const dialect = new PgDialect();
const render = (w: any) => {
  const q = dialect.sqlToQuery(w);
  return { sql: q.sql, params: q.params };
};

vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  client: {},
  db: {
    delete: () => ({ where: async (w: any) => { ops.push({ op: 'delete', where: render(w) }); } }),
    update: () => ({ set: (set: Record<string, unknown>) => ({ where: async (w: any) => { ops.push({ op: 'update', set, where: render(w) }); } }) }),
    insert: () => ({ values: (values: Record<string, unknown>) => ({ onConflictDoUpdate: async () => { ops.push({ op: 'insert', values }); } }) }),
  },
}));

describe('DrizzleSeoRepository.recordSlugChange', () => {
  beforeEach(() => { ops.length = 0; });

  it('repoints every earlier redirect aimed at the old path to the new one, before inserting the new row', async () => {
    const { DrizzleSeoRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleSeoRepository');
    const out = await new DrizzleSeoRepository().recordSlugChange({ oldSlug: 'b', newSlug: 'c', createdBy: null, now: new Date() });
    expect(out).toEqual({ fromPath: '/p/b', toPath: '/p/c' });

    const update = ops.find((o) => o.op === 'update');
    expect(update, 'no chain-collapsing update was issued').toBeDefined();
    expect(update!.set).toEqual({ toPath: '/p/c' });
    expect(update!.where!.sql).toMatch(/"to_path" in/);
    expect(update!.where!.params).toEqual(['/p/b', '/products/b']);

    // Order matters: the loop clear runs first so the collapse can never
    // produce a row from the new path to itself; the new row comes last.
    expect(ops.map((o) => o.op)).toEqual(['delete', 'update', 'insert']);
    expect(ops[0].where!.sql).toMatch(/"from_path" in/);
    expect(ops[0].where!.params).toEqual(['/p/c', '/products/c']);
    expect(ops[2].values).toMatchObject({ fromPath: '/p/b', toPath: '/p/c', statusCode: 301 });
  });
});
