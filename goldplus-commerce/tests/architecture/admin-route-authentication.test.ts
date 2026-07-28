/**
 * tests/architecture/admin-route-authentication.test.ts
 *
 * Real-composition-root admin route protection test.
 *
 * The pre-existing route-module-reachability test performs static text analysis of app.ts.
 * That cannot detect three defect classes that were present in this repository:
 *
 *   1. A route module that exists and is fully implemented but is never mounted
 *      (`routes/admin/controlled-activation.ts` — 9 RBAC-protected endpoints, shipped
 *      admin UI, and `/admin/controlled-activation/summary` returned 404).
 *   2. A router mounted under /admin that carries no authentication at all, because it
 *      lives in `presentation/routes/` rather than `interfaces/http/routes/admin/`
 *      (an unauthenticated POST reached the use case and the database).
 *   3. A route that trusts a caller-supplied admin identity in the request body.
 *
 * This test therefore drives the REAL Hono app via `app.request()` instead of reading
 * source as text. Only the Registry and the auth middleware are substituted, so the
 * router graph, mount paths, mount ordering and per-route middleware are the real ones.
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

/** Records which use cases actually executed, so we can assert nothing ran while unauthorised. */
const executed: string[] = [];

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: {
    getInstance: () =>
      new Proxy(
        {},
        {
          get: (_target, prop) => ({
            execute: async () => {
              executed.push(String(prop));
              return { id: 'stub', ok: true };
            },
          }),
        },
      ),
  },
}));

// Token-shaped auth double: "Bearer none" = no permissions, "Bearer admin" = full permissions.
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
    c.set('user', {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'admin@example.com',
      permissions: auth.includes('admin') ? Object.values(PERMISSIONS) : [],
    });
    await next();
  },
}));

import app from '../../apps/api/src/interfaces/http/app';

const J = { 'Content-Type': 'application/json' };
const root = process.cwd();
const APP_TS = path.join(root, 'apps/api/src/interfaces/http/app.ts');

/**
 * Endpoints that are mounted under /admin but whose routers live outside
 * interfaces/http/routes/admin/. These were entirely unprotected.
 */
const CONTROLLED_ACTIVATION_SURFACES: Array<{ path: string; init: RequestInit }> = [
  { path: '/admin/controlled-activation/live-canaries?activationRequestId=r', init: { method: 'GET' } },
  {
    path: '/admin/controlled-activation/live-canaries',
    init: {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        dryRunId: 'd',
        activationRequestId: 'a',
        canaryCap: 1,
        destinationAllowlist: [],
        rollbackPlan: 'r',
        monitoringOwner: 'm',
      }),
    },
  },
  {
    path: '/admin/controlled-activation-dry-run/execution-plans',
    init: {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        activationRequestId: 'r',
        activationScope: 's',
        environment: 'production',
      }),
    },
  },
  {
    path: '/admin/controlled-activation-dry-run/dry-runs',
    init: { method: 'POST', headers: J, body: JSON.stringify({ executionPlanId: 'p' }) },
  },
  { path: '/admin/controlled-activation/summary', init: { method: 'GET' } },
];

describe('Admin route authentication (real Hono composition root)', () => {
  it('rejects every controlled-activation admin surface without credentials', async () => {
    for (const { path: p, init } of CONTROLLED_ACTIVATION_SURFACES) {
      executed.length = 0;
      const res = await app.request(p, init);
      expect(res.status, `${p} must not be reachable unauthenticated`).toBe(401);
      expect(executed, `${p} must not execute a use case unauthenticated`).toHaveLength(0);
    }
  });

  it('rejects controlled-activation admin surfaces when authenticated without permissions', async () => {
    for (const { path: p, init } of CONTROLLED_ACTIVATION_SURFACES) {
      executed.length = 0;
      const res = await app.request(p, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: 'Bearer none' },
      });
      expect([401, 403], `${p} must deny a permissionless caller (got ${res.status})`).toContain(
        res.status,
      );
      expect(executed, `${p} must not execute a use case without permission`).toHaveLength(0);
    }
  });

  it('mounts the controlled-activation governance router (it was implemented but unreachable)', async () => {
    const res = await app.request('/admin/controlled-activation/summary', {
      headers: { Authorization: 'Bearer admin' },
    });
    expect(res.status, '/admin/controlled-activation/summary must not 404').not.toBe(404);
  });

  it('keeps the more specific /live-canaries mount from being shadowed', async () => {
    const res = await app.request(
      '/admin/controlled-activation/live-canaries?activationRequestId=r',
      { headers: { Authorization: 'Bearer admin' } },
    );
    // The canary list handler answers; the governance router has no such path.
    expect(res.status).toBe(200);
    expect(executed).toContain('listControlledLiveCanariesUseCase');
  });

  it('derives acting-admin identity from the session, never from the request body', async () => {
    const canary = path.join(
      root,
      'apps/api/src/presentation/routes/controlled-live-canary.ts',
    );
    const dryRun = path.join(
      root,
      'apps/api/src/presentation/routes/controlled-activation-dry-run.ts',
    );
    for (const f of [canary, dryRun]) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, `${f} must not forward a body-supplied admin id`).not.toMatch(
        /AdminId:\s*data\.\w*AdminId/,
      );
      expect(src, `${f} must not forward a body-supplied adminId`).not.toMatch(
        /adminId:\s*data\.adminId/,
      );
    }
  });

  it('does not resolve activation permissions from a hard-coded stub', () => {
    const src = fs.readFileSync(
      path.join(root, 'apps/api/src/presentation/routes/controlled-activation-dry-run.ts'),
      'utf8',
    );
    expect(src, 'access policy must not use a fixed permission stub').not.toMatch(
      /findPermissionsForUser:\s*async\s*\(\)\s*=>\s*\[/,
    );
  });

  it('detects any route module that exists but is never imported by app.ts', () => {
    const appSrc = fs.readFileSync(APP_TS, 'utf8');
    const routesDir = path.join(root, 'apps/api/src/interfaces/http/routes');

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [full] : [];
      });

    const imported = new Set<string>();
    const re = /from\s+['"`](\.\/routes\/[^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(appSrc)) !== null) imported.add(m[1].replace(/^\.\//, ''));

    const orphans = walk(routesDir)
      .map((f) => path.relative(path.join(root, 'apps/api/src/interfaces/http'), f).replace(/\.ts$/, ''))
      .filter((rel) => ![...imported].some((i) => i === rel || i === rel.replace(/\/index$/, '')));

    expect(
      orphans,
      `Route modules implemented but never mounted:\n${orphans.join('\n')}`,
    ).toHaveLength(0);
  });
});
