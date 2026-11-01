import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { guardLoyaltyIssuance } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/**
 * Referral, birthday, scan, mission, draw and backfill credits checked only the
 * DB switch and the kill switch: the deployment key and the budget cap stopped
 * order earning alone.
 */
describe('one issuance gate for every non-order credit', () => {
  const base = { enabled: true, killSwitch: false, budgetCapPoints: 1_000 } as const;
  const completion = (issued: number) => ({
    getProgrammeConfig: vi.fn().mockResolvedValue({ ...base }),
    lifetimeIssuedPoints: vi.fn().mockResolvedValue(issued),
    recordFraudSignal: vi.fn().mockResolvedValue(undefined),
    reservedPoints: vi.fn().mockResolvedValue(7),
  });

  it('the deployment key off reads as the kill switch', async () => {
    const guarded = guardLoyaltyIssuance(completion(0) as never, { isActive: async () => false });
    expect((await guarded.getProgrammeConfig()).killSwitch).toBe(true);
  });

  it('a reached budget cap reads as the kill switch and raises a signal', async () => {
    const c = completion(1_000);
    const guarded = guardLoyaltyIssuance(c as never, { isActive: async () => true });
    expect((await guarded.getProgrammeConfig()).killSwitch).toBe(true);
    expect(c.recordFraudSignal).toHaveBeenCalledWith(expect.objectContaining({ signalType: 'BUDGET_CAP_PAUSED_EARN' }));
  });

  it('under the cap with the key on, nothing changes, and other methods pass through', async () => {
    const c = completion(10);
    const guarded = guardLoyaltyIssuance(c as never, { isActive: async () => true });
    expect((await guarded.getProgrammeConfig()).killSwitch).toBe(false);
    expect(await guarded.reservedPoints('acc')).toBe(7);
  });

  it('every non-order credit path is wired through the gate, and issued counts adjustments', () => {
    const registry = read('apps/api/src/infrastructure/Registry.ts');
    for (const uc of ['BackfillGuestOrdersUseCase', 'EvaluateGamificationForUserUseCase', 'QualifyReferralOnDeliveryUseCase', 'AwardBirthdayPointsUseCase', 'EarnForCounterfeitConfirmationUseCase', 'EarnForPhoneVerificationUseCase', 'PlayDrawTokenUseCase']) {
      const at = registry.indexOf(`new ${uc}(`);
      expect(registry.slice(at, at + 200), uc).toContain('this.loyaltyIssuanceCompletion');
    }
    expect(registry).toContain('new EarnForVerificationScanUseCase(this.loyaltyRepo, this.loyaltyIssuanceCompletion)');
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository.ts');
    expect(repo).toMatch(/where points > 0 and type in \('earn', 'adjustment'\)/);
  });
});
