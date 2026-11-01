import { describe, expect, it } from 'vitest';
import { BackfillGuestOrdersUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyIdentityUseCases';

/**
 * The cap is per CUSTOMER. Every phone verification runs the backfill, and the
 * cap used to be counted from zero on each run, so re-verifying credited the
 * orders the first run had skipped at the cap.
 */
describe('guest-order backfill cap', () => {
  function harness() {
    const ledger: Array<{ type: string; points: number; reason: string; idempotencyKey: string }> = [];
    const loyalty = {
      getOrCreateAccount: async () => ({ id: 'acc-1' }),
      listEntries: async () => ledger.map((e) => ({ ...e })),
      append: async (e: { type: string; points: number; reason: string; idempotencyKey: string }) => {
        const seen = ledger.find((l) => l.idempotencyKey === e.idempotencyKey);
        if (seen) {
          if (seen.points !== e.points) throw new Error('LOYALTY_IDEMPOTENCY_CONFLICT');
          return { entry: seen, replay: true };
        }
        ledger.push(e);
        return { entry: e, replay: false };
      },
    };
    const identity = {
      phoneVerifiedAt: async () => new Date(),
      guestOrdersForPhone: async () => [
        { orderId: 'o1', totalUgx: 400_000, buyerType: 'retail' },
        { orderId: 'o2', totalUgx: 300_000, buyerType: 'retail' },
        { orderId: 'o3', totalUgx: 300_000, buyerType: 'retail' },
      ],
    };
    const completion = {
      getProgrammeConfig: async () => ({ enabled: true, killSwitch: false, guestBackfillLookbackDays: 365, guestBackfillCapPoints: 5_000, earnRatePer1000Ugx: 10, expiryDays: 365 }),
    };
    const uc = new BackfillGuestOrdersUseCase(identity as never, loyalty as never, completion as never, { save: async () => undefined } as never);
    return { uc, ledger };
  }

  it('a second verification credits nothing past the cap', async () => {
    const { uc, ledger } = harness();
    const first = await uc.execute({ userId: 'u1', phoneE164: '+256700000000' });
    const second = await uc.execute({ userId: 'u1', phoneE164: '+256700000000' });
    expect(first).toMatchObject({ ok: true, points: 5_000 });
    expect(second).toMatchObject({ ok: true, points: 0 });
    expect(ledger.reduce((a, e) => a + e.points, 0)).toBe(5_000);
  });
});
