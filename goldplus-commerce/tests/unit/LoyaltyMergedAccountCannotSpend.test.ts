import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ReserveRedemptionUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases';
import { EvaluateTiersUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyProgrammeUseCases';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/** After a merge the survivor spends the points; the merged login spending them too doubled them. */
describe('a merged account cannot spend points already counted on its survivor', () => {
  it('reserving from the merged login is refused', async () => {
    const repo = { getOrCreateAccount: async () => ({ id: 'M' }), mergedInto: async () => 'S', listEntries: vi.fn() };
    const completion = { getProgrammeConfig: async () => ({ killSwitch: false }), reservedPoints: vi.fn(), createReservation: vi.fn() };
    const uc = new ReserveRedemptionUseCase(repo as never, completion as never, { isActive: async () => true } as never);
    const out = await uc.execute({ userId: 'u-m', points: 2_000, orderGoodsTotalUgx: 500_000, idempotencyKey: 'k' });
    expect(out).toMatchObject({ ok: false, code: 'ACCOUNT_MERGED' });
    expect(completion.createReservation).not.toHaveBeenCalled();
  });

  it('the ledger debit refuses a merged source account inside its lock', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts');
    const debit = src.slice(src.indexOf('async appendDebitIfAvailable'), src.indexOf('async expireDue'));
    expect(debit).toMatch(/where merged_account_id = \$\{input\.accountId\}/);
    expect(debit).toMatch(/return \{ ok: false, code: 'ACCOUNT_MERGED' \}/);
  });

  it('tiers skip merged source accounts', async () => {
    const assign = vi.fn();
    const uc = new EvaluateTiersUseCase(
      { mergedInto: async (id: string) => (id === 'M' ? 'S' : null), listEntries: async () => [{ type: 'earn', points: 5_000 }] } as never,
      { listAccountIds: async () => [{ accountId: 'M', userId: 'um' }, { accountId: 'S', userId: 'us' }] } as never,
      { activeTiers: async () => [{ code: 'gold', name: 'Gold', rank: 1, thresholdLifetimePoints: 1_000 }], currentAssignment: async () => null, assign } as never,
      async () => undefined,
    );
    await uc.execute();
    expect(assign.mock.calls.map((c) => c[0])).toEqual(['S']);
  });
});
