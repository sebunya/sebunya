import { describe, expect, it } from 'vitest';
import { CONTROL_CENTRE_MODULES } from '@goldplus/shared';

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
