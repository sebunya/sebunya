import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every AI Search route carries the permission its risk needs: spending needs
 * RUN, approving needs APPROVE, provider keys need CREDENTIALS, and nothing is
 * reachable with no permission check at all.
 */
const src = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/admin/ai-visibility.ts'), 'utf8');
const routes = [...src.matchAll(/routes\.(get|post|put|patch|delete)\('([^']+)',\s*(\w+)/g)].map((m) => ({ method: m[1].toUpperCase(), path: m[2], guard: m[3] }));

describe('AI Search route permissions', () => {
  it('finds the routes and guards every one', () => {
    expect(routes.length).toBeGreaterThan(30);
    for (const r of routes) expect(['VIEW', 'MANAGE', 'RUN', 'APPROVE', 'CREDENTIALS'], `${r.method} ${r.path}`).toContain(r.guard);
  });
  it('reads are VIEW; nothing that writes is VIEW', () => {
    for (const r of routes) {
      if (r.method === 'GET') expect(r.guard, r.path).toBe('VIEW');
      else expect(r.guard, `${r.method} ${r.path}`).not.toBe('VIEW');
    }
  });
  it('spend, approval and keys use their own permissions', () => {
    const g = (m: string, p: string) => routes.find((r) => r.method === m && r.path === p)?.guard;
    expect(g('POST', '/projects/:project/runs')).toBe('RUN');
    expect(g('POST', '/projects/:project/research')).toBe('RUN');
    expect(g('POST', '/projects/:project/runs/:runId/approve')).toBe('APPROVE');
    expect(g('POST', '/projects/:project/actions/:actionId/approve')).toBe('APPROVE');
    expect(g('POST', '/projects/:project/actions/:actionId/reject')).toBe('APPROVE');
    expect(g('PUT', '/projects/:project/providers/:provider/credential')).toBe('CREDENTIALS');
    expect(g('DELETE', '/projects/:project/providers/:provider/credential')).toBe('CREDENTIALS');
    expect(g('POST', '/projects/:project/providers/:provider/test')).toBe('CREDENTIALS');
  });
  it('the actor header can only lower privilege', () => {
    expect(src).toMatch(/MACHINE\.has\(declared\) \? \(declared as Actor\['kind'\]\) : 'USER'/);
    expect(src).not.toMatch(/x-actor-id/i);
  });
});
