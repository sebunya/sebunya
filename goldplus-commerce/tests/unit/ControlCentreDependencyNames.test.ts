import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { CONTROL_CENTRE_MODULES, PERMISSIONS } from '@goldplus/shared';

const ROOT_DIR = resolve(__dirname, '../..');

/**
 * The dependency probe (DrizzleControlCentreProbes) begins with
 *   if (name !== 'postgres') return false;
 * so a data dependency named anything else can NEVER report UP, whatever the
 * database actually contains.
 *
 * seo-organic-growth named its two dependencies after their tables and was
 * therefore shown as DEGRADED in the Trust Centre for as long as it existed,
 * against tables that were present and populated. An admin console that
 * invents outages is worse than one that shows none, because it teaches the
 * operator to ignore the amber.
 */
describe('control centre module registry', () => {
  it('declares every data dependency with a name the probe can resolve', () => {
    const offenders: string[] = [];
    for (const module of CONTROL_CENTRE_MODULES) {
      for (const dep of module.dataDependencies ?? []) {
        if (dep.name !== 'postgres') {
          offenders.push(`${module.moduleKey}: dataDependency name "${dep.name}" (table ${dep.table ?? '—'})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a postgres dependency without a table is a connectivity check, not a mistake', () => {
    // The probe runs `select 1` when no table is named, so 15 modules
    // legitimately declare { name: 'postgres' } alone. Asserted so nobody
    // "tidies" those into table checks and changes what they mean.
    const bare = CONTROL_CENTRE_MODULES.flatMap((m) =>
      (m.dataDependencies ?? []).filter((d) => d.name === 'postgres' && !d.table),
    );
    expect(bare.length).toBeGreaterThan(0);
  });
});

describe('the console represents the capabilities the shop actually has', () => {
  it('messaging is a module, so a shop that cannot send email cannot report all-green', () => {
    // 33 admin order emails had dead-lettered on the provider's HTTP 429 while
    // the Trust Centre listed 27 modules, every one LIVE, and none of them was
    // messaging. A health surface that cannot represent a capability cannot
    // report it broken.
    const notifications = CONTROL_CENTRE_MODULES.find((m) => m.key === 'notifications');
    expect(notifications).toBeTruthy();
    expect(notifications!.providerDependencies).toEqual(expect.arrayContaining(['email', 'sms']));
    expect(notifications!.dataDependencies?.[0]).toMatchObject({ name: 'postgres', table: 'outbox_events' });
  });

  it('every module points at a permission that exists', () => {
    // The registry keeps a curated alias of PERMISSIONS; naming one that is not
    // in it does not fail until the module is evaluated.
    const known = new Set(Object.values(PERMISSIONS));
    const offenders: string[] = [];
    for (const m of CONTROL_CENTRE_MODULES) {
      for (const p of [...(m.requiredPermissions ?? []), ...(m.optionalPermissions ?? [])]) {
        if (!known.has(p as never)) offenders.push(`${m.key}: ${p}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a module can report that it is not achieving anything', () => {
  it('messaging declares an outcome check, not just a table and credentials', () => {
    const n = CONTROL_CENTRE_MODULES.find((m) => m.key === 'notifications')!;
    expect(n.healthChecks).toEqual(['notification_delivery']);
  });

  it('a failing check degrades the module and says why', async () => {
    const { EvaluateModuleReadinessUseCase } = await import(
      '../../apps/api/src/application/use-cases/control-centre/EvaluateModuleReadinessUseCase'
    );
    const only = CONTROL_CENTRE_MODULES.filter((m) => m.key === 'notifications');
    const useCase = new EvaluateModuleReadinessUseCase(
      { isUp: async () => true },
      { isMounted: () => true },
      { isConfigured: () => true },
      { isApproved: async () => true },
      () => new Date('2026-08-30T00:00:00Z'),
      only,
      { check: async () => ({ healthy: false, detail: '33 messages dead-lettered in the last 7 days' }) },
    );
    const summary = await useCase.execute({ actorPermissions: [], traceId: 't' });
    const row = (summary as { modules: Array<Record<string, unknown>> }).modules[0];
    // Reachable, switched on — and still not working, which is the whole point.
    expect(row.serviceStatus).toBe('DEGRADED');
    expect(String(row.degradedReasons)).toContain('dead-lettered');
  });

  it('is LIVE when the same check passes, so the signal means something', async () => {
    const { EvaluateModuleReadinessUseCase } = await import(
      '../../apps/api/src/application/use-cases/control-centre/EvaluateModuleReadinessUseCase'
    );
    const only = CONTROL_CENTRE_MODULES.filter((m) => m.key === 'notifications');
    const useCase = new EvaluateModuleReadinessUseCase(
      { isUp: async () => true },
      { isMounted: () => true },
      { isConfigured: () => true },
      { isApproved: async () => true },
      () => new Date('2026-08-30T00:00:00Z'),
      only,
      { check: async () => ({ healthy: true }) },
    );
    const summary = await useCase.execute({ actorPermissions: [], traceId: 't' });
    expect((summary as { modules: Array<Record<string, unknown>> }).modules[0].serviceStatus).toBe('LIVE');
  });
});

describe('the messaging check blames messaging, and nothing else', () => {
  it('excludes telemetry, which shares the outbox but not the fault', async () => {
    const src = require('node:fs').readFileSync(
      resolve(ROOT_DIR, 'apps/api/src/infrastructure/control-centre/DrizzleControlCentreProbes.ts'),
      'utf8',
    );
    // Telemetry has its own dispatcher, backoff and dead-letter meaning.
    // Counting it would make notifications DEGRADED for an analytics fault the
    // moment email is fixed — a false alarm, which is how amber gets ignored.
    expect(src).toMatch(/and event_type <> \$\{EVENT_TYPE_TELEMETRY\}/);
    // One source for that name, so it cannot drift from the dispatcher's.
    expect(src).toMatch(/import \{ EVENT_TYPE_TELEMETRY \} from '\.\.\/telemetry\/TelemetryDispatchService'/);
  });

  it('an unknown check fails rather than quietly passing', () => {
    const src = require('node:fs').readFileSync(
      resolve(ROOT_DIR, 'apps/api/src/infrastructure/control-centre/DrizzleControlCentreProbes.ts'),
      'utf8',
    );
    expect(src).toMatch(/unknown health check/);
  });
});
