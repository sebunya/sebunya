import { describe, expect, it } from 'vitest';
import { ManagePromotionCapacityUseCase, PricingCapacityError } from '../../apps/api/src/application/use-cases/pricing/ManagePromotionCapacityUseCase';

describe('Pricing P3 capacity use case', () => {
  it('passes one bounded checkout key to the transactional reservation port', async () => {
    const calls: any[] = [];
    const port: any = { reserveQuote: async (input: any) => { calls.push(input); return { reservations: [], duplicate: false }; } };
    const useCase = new ManagePromotionCapacityUseCase(port);
    const now = new Date('2026-07-20T00:00:00Z');
    await useCase.reserve({ quoteId: 'quote-1', checkoutKey: 'checkout:key-1', now });
    expect(calls).toEqual([{ quoteId: 'quote-1', idempotencyKey: 'checkout:key-1', now }]);
  });

  it('rejects missing or unbounded reservation identity', async () => {
    const useCase = new ManagePromotionCapacityUseCase({} as any);
    expect(() => useCase.reserve({ quoteId: '', checkoutKey: 'ok-key' })).toThrow(PricingCapacityError);
    expect(() => useCase.reserve({ quoteId: 'quote-1', checkoutKey: 'unsafe key' })).toThrow(expect.objectContaining({ code: 'INVALID_RESERVATION' }));
  });

  it('delegates idempotent redemption and release without creating another capacity model', async () => {
    const calls: string[] = [];
    const port: any = {
      redeemQuote: async () => { calls.push('redeem'); return { reservationIds: ['r1'], duplicate: false }; },
      releaseQuote: async () => { calls.push('release'); return { reservationIds: ['r2'], duplicate: true }; },
    };
    const useCase = new ManagePromotionCapacityUseCase(port);
    expect((await useCase.redeem({ quoteId: 'q1', orderId: 'o1' })).reservationIds).toEqual(['r1']);
    expect((await useCase.release({ quoteId: 'q2' })).duplicate).toBe(true);
    expect(calls).toEqual(['redeem', 'release']);
  });
});
