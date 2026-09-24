import { describe, expect, it, vi } from 'vitest';
import { parseProgrammeConfigPatch, SaveLoyaltyProgrammeConfigUseCase } from '../../apps/api/src/application/use-cases/loyalty/SaveLoyaltyProgrammeConfigUseCase';

/**
 * The documented kill step, {"chanceEnabled": false}, used to null the point
 * value, the budget cap and every bonus earn source and release the kill switch.
 */
describe('programme-config is a PATCH', () => {
  it('the kill step changes only chanceEnabled', () => {
    expect(parseProgrammeConfigPatch({ chanceEnabled: false })).toEqual({ ok: true, patch: { chanceEnabled: false } });
    expect(parseProgrammeConfigPatch({ killSwitch: true })).toEqual({ ok: true, patch: { killSwitch: true } });
  });

  it('an explicit null still clears a nullable field', () => {
    expect(parseProgrammeConfigPatch({ birthdayPoints: null })).toEqual({ ok: true, patch: { birthdayPoints: null } });
  });

  it('refuses bad values and an empty patch', () => {
    expect(parseProgrammeConfigPatch({ redemptionMaxShareBps: 10_001 }).ok).toBe(false);
    expect(parseProgrammeConfigPatch({ pointValueUgx: -1 }).ok).toBe(false);
    expect(parseProgrammeConfigPatch({ killSwitch: 'false' }).ok).toBe(false);
    expect(parseProgrammeConfigPatch({}).ok).toBe(false);
    expect(parseProgrammeConfigPatch({ unknown: 5 }).ok).toBe(false);
  });

  it('the writer receives only the named keys and the response is the re-read config', async () => {
    const save = vi.fn();
    const stored = { pointValueUgx: 20, budgetCapPoints: 1_000_000, chanceEnabled: true };
    const uc = new SaveLoyaltyProgrammeConfigUseCase(
      { save: async (p) => { save(p); Object.assign(stored, p); } },
      async () => ({ ...stored }),
      { save: vi.fn() } as never,
    );
    const out = await uc.execute({ chanceEnabled: false }, '00000000-0000-4000-8000-000000000001');
    expect(save).toHaveBeenCalledWith({ chanceEnabled: false });
    expect(out).toEqual({ ok: true, config: { pointValueUgx: 20, budgetCapPoints: 1_000_000, chanceEnabled: false } });
  });
});
