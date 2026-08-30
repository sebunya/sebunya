import { describe, expect, it } from 'vitest';
import { CONTROL_CENTRE_MODULES, PERMISSIONS } from '@goldplus/shared';

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
