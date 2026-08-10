import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTROL_CENTRE_MODULES,
  MODULE_SERVICE_STATUSES,
  MODULE_ACCESS_STATUSES,
  MODULE_ACTIVATION_STATUSES,
} from '@goldplus/shared';
import { MOUNTED_API_PREFIXES } from '../../apps/api/src/interfaces/http/app';
import { EvaluateModuleReadinessUseCase } from '../../apps/api/src/application/use-cases/control-centre/EvaluateModuleReadinessUseCase';

const repoRoot = path.resolve(__dirname, '../..');

/** Probes that let a test drive the use case without a database. */
const probes = (opts: {
  mounted?: boolean;
  dependencyUp?: boolean;
  providerConfigured?: boolean;
  approved?: boolean;
}) => ({
  dependencies: { isUp: async () => opts.dependencyUp ?? true },
  routes: { isMounted: () => opts.mounted ?? true },
  providers: { isConfigured: () => opts.providerConfigured ?? true },
  approvals: { isApproved: async () => opts.approved ?? true },
});

const run = (opts: Parameters<typeof probes>[0], permissions: string[] = []) => {
  const p = probes(opts);
  return new EvaluateModuleReadinessUseCase(
    p.dependencies,
    p.routes,
    p.providers,
    p.approvals,
  ).execute({ actorPermissions: permissions, traceId: 'test-trace' });
};

describe('Control Centre module registry', () => {
  it('declares no status fields — status is computed, never authored', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'packages/shared/src/control-centre/module-registry.ts'),
      'utf8',
    );
    // Scope the scan to the module ARRAY LITERAL only. The result interface further
    // down legitimately declares these fields — it is the shape of a computed
    // answer. What must never appear is a status assigned to a module definition:
    // a literal `serviceStatus: 'LIVE'` there is the exact defect that let the old
    // admin surface claim health it had never observed.
    const start = source.indexOf('export const CONTROL_CENTRE_MODULES');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n] as const;', start);
    expect(end).toBeGreaterThan(start);
    const moduleBlock = source.slice(start, end);

    expect(moduleBlock).not.toMatch(/serviceStatus\s*:/);
    expect(moduleBlock).not.toMatch(/accessStatus\s*:/);
    expect(moduleBlock).not.toMatch(/activationStatus\s*:/);
    // Nor may a module hard-code a status vocabulary value anywhere in its body.
    for (const literal of ['LIVE', 'DEGRADED', 'UNAVAILABLE']) {
      expect(moduleBlock).not.toMatch(new RegExp(`['"]${literal}['"]`));
    }
  });

  it('gives every module a unique key', () => {
    const keys = CONTROL_CENTRE_MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every screenshot-visible module', () => {
    const required = [
      'products', 'orders', 'recommendations', 'measurement', 'support', 'legal', 'loyalty',
      'decision-intelligence', 'customer-dna', 'shopping-assistant', 'automation', 'surveys',
      'copy-quality', 'behavioural-interventions', 'experiments', 'pricing', 'fraud',
      'pim-import', 'loyalty-os', 'search-insights', 'inventory-fulfilment',
      'measurement-control-tower', 'release-readiness', 'provider-readiness',
    ];
    const keys = new Set(CONTROL_CENTRE_MODULES.map((m) => m.key));
    for (const key of required) expect(keys, `missing module: ${key}`).toContain(key);
  });
});

describe('route coverage', () => {
  it('mounts the API prefix every module depends on', () => {
    const unmounted = CONTROL_CENTRE_MODULES.filter((module) => {
      if (MOUNTED_API_PREFIXES.includes(module.apiMount)) return false;
      return !MOUNTED_API_PREFIXES.some((p) => p.startsWith(`${module.apiMount}/`));
    });
    expect(unmounted.map((m) => `${m.key} -> ${m.apiMount}`)).toEqual([]);
  });

  it('mounts the aggregated readiness endpoint itself', () => {
    expect(MOUNTED_API_PREFIXES).toContain('/admin/control-centre');
  });

  it('keeps MOUNTED_API_PREFIXES exactly in step with the real app.route calls', () => {
    // MOUNTED_API_PREFIXES is what the readiness probe trusts. If it drifts from
    // the actual mounts it becomes the same class of lie this programme exists to
    // remove: a removed router would still be reported LIVE, and a newly added one
    // would be reported UNAVAILABLE. Derive the truth from the source and compare.
    const appSource = fs.readFileSync(
      path.join(repoRoot, 'apps/api/src/interfaces/http/app.ts'),
      'utf8',
    );
    const declared = [...appSource.matchAll(/app\.route\('([^']+)'/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(50);
    expect([...MOUNTED_API_PREFIXES].sort()).toEqual([...new Set(declared)].sort());
  });
});

describe('card-to-route integrity', () => {
  it('points every module and action at an admin page that exists', () => {
    const pagesDir = path.join(repoRoot, 'apps/web/src/pages');
    const resolves = (route: string): boolean => {
      const rel = route.replace(/^\//, '');
      return (
        fs.existsSync(path.join(pagesDir, `${rel}.astro`)) ||
        fs.existsSync(path.join(pagesDir, rel, 'index.astro'))
      );
    };
    const broken: string[] = [];
    for (const module of CONTROL_CENTRE_MODULES) {
      if (!resolves(module.adminRoute)) broken.push(`${module.key} -> ${module.adminRoute}`);
      for (const action of module.supportedActions) {
        // READ actions navigate to an admin page, so the page must exist.
        // WRITE/APPROVE/DIAGNOSTIC actions target the API endpoint they call
        // (ModuleAction.target: "Route the button navigates to, or API endpoint
        // it calls") — endpoint reachability is covered by the apiMount checks
        // above, not by the pages directory.
        if (action.kind !== 'READ') continue;
        if (action.target.startsWith('/admin') && !resolves(action.target)) {
          broken.push(`${module.key}.${action.key} -> ${action.target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('status integrity', () => {
  it('reports LIVE only when the route is mounted and dependencies answer', async () => {
    const healthy = await run({ mounted: true, dependencyUp: true });
    expect(healthy.modules.every((m) => m.serviceStatus === 'LIVE')).toBe(true);
  });

  it('reports UNAVAILABLE when the API mount is missing', async () => {
    const unmounted = await run({ mounted: false });
    expect(unmounted.modules.every((m) => m.serviceStatus === 'UNAVAILABLE')).toBe(true);
    expect(unmounted.liveModules).toBe(0);
  });

  it('reports DEGRADED — not UNAVAILABLE — when a dependency is down', async () => {
    const summary = await run({ mounted: true, dependencyUp: false });
    const withDeps = summary.modules.filter((m) => m.dependencies.length > 0);
    expect(withDeps.length).toBeGreaterThan(0);
    expect(withDeps.every((m) => m.serviceStatus === 'DEGRADED')).toBe(true);
  });

  it('never lets permission or activation degrade service status', async () => {
    // No permissions at all, nothing approved, no provider configured.
    const summary = await run(
      { mounted: true, dependencyUp: true, providerConfigured: false, approved: false },
      [],
    );
    expect(summary.modules.every((m) => m.serviceStatus === 'LIVE')).toBe(true);
    expect(summary.unavailableModules).toBe(0);
  });

  it('reports a protected, healthy, approved module as LIVE / PROTECTED-or-APPROVAL / ACTIVE', async () => {
    const summary = await run({ mounted: true, dependencyUp: true, approved: true }, ['ORDERS_READ']);
    const orders = summary.modules.find((m) => m.moduleKey === 'orders');
    expect(orders).toBeDefined();
    expect(orders!.serviceStatus).toBe('LIVE');
    expect(orders!.accessStatus).toBe('PROTECTED');
    expect(orders!.activationStatus).toBe('ACTIVE');
  });

  it('holds loyalty DORMANT until an operator approval exists, while staying LIVE', async () => {
    const dormant = await run({ mounted: true, dependencyUp: true, approved: false });
    const loyalty = dormant.modules.find((m) => m.moduleKey === 'loyalty');
    expect(loyalty!.serviceStatus).toBe('LIVE');
    expect(loyalty!.activationStatus).toBe('DORMANT');

    const active = await run({ mounted: true, dependencyUp: true, approved: true });
    expect(active.modules.find((m) => m.moduleKey === 'loyalty')!.activationStatus).toBe('ACTIVE');
  });

  it('marks a provider module NOT_CONFIGURED rather than unavailable', async () => {
    const summary = await run({ mounted: true, dependencyUp: true, providerConfigured: false });
    const provider = summary.modules.find((m) => m.moduleKey === 'provider-readiness');
    expect(provider!.serviceStatus).toBe('LIVE');
    expect(provider!.activationStatus).toBe('NOT_CONFIGURED');
  });

  it('offers only actions the caller is permitted to perform', async () => {
    const summary = await run({ mounted: true }, []);
    const orders = summary.modules.find((m) => m.moduleKey === 'orders');
    expect(orders!.availableActions).toEqual([]);

    // The fixture must speak the vocabulary a real session carries — the
    // canonical dotted name. The old constant-style 'ORDERS_READ' here is the
    // exact mismatch that let every Trust Centre module read permission-denied
    // in production while this test stayed green.
    const permitted = await run({ mounted: true }, ['orders.read']);
    expect(permitted.modules.find((m) => m.moduleKey === 'orders')!.availableActions).toHaveLength(1);
  });

  it('emits only statuses from the declared vocabularies', async () => {
    const summary = await run({ mounted: true });
    for (const module of summary.modules) {
      expect(MODULE_SERVICE_STATUSES).toContain(module.serviceStatus);
      expect(MODULE_ACCESS_STATUSES).toContain(module.accessStatus);
      expect(MODULE_ACTIVATION_STATUSES).toContain(module.activationStatus);
    }
  });

  it('carries the trace ID onto every module result', async () => {
    const summary = await run({ mounted: true });
    expect(summary.modules.every((m) => m.traceId === 'test-trace')).toBe(true);
  });

  it('never leaks a credential value into the readiness payload', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'super-secret-value';
    const summary = await run({ mounted: true, providerConfigured: true });
    expect(JSON.stringify(summary)).not.toContain('super-secret-value');
    delete process.env.WHATSAPP_ACCESS_TOKEN;
  });
});

describe('permission vocabulary', () => {
  it('every registry permission is a CANONICAL name a session can actually carry', async () => {
    const { PERMISSIONS } = await import('../../packages/shared/src/permissions');
    const canonical = new Set(Object.values(PERMISSIONS));
    for (const module of CONTROL_CENTRE_MODULES) {
      for (const perm of [...module.requiredPermissions, ...module.optionalPermissions]) {
        expect(canonical.has(perm as never), `${module.key}: '${perm}' is not a canonical permission`).toBe(true);
      }
      for (const action of module.supportedActions) {
        if (action.requiredPermission) {
          expect(canonical.has(action.requiredPermission as never), `${module.key}/${action.key}: '${action.requiredPermission}'`).toBe(true);
        }
      }
    }
  });
});
