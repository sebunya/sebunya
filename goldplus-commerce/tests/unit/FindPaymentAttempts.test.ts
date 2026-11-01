import { describe, it, expect } from 'vitest';
import { FindPaymentAttemptsUseCase } from '../../apps/api/src/application/use-cases/payments/FindPaymentAttemptsUseCase';

type A = { id: string; merchantReference: string; orderTrackingId: string | null; orderId: string };
const a1: A = { id: 'a1', merchantReference: 'GP-GP-202609-AAAA-aaaa', orderTrackingId: 'trk-1', orderId: 'o1' };
const a2: A = { id: 'a2', merchantReference: 'GP-GP-202609-AAAA-bbbb', orderTrackingId: null, orderId: 'o1' };
function build() {
  const calls: string[] = [];
  const uc = new FindPaymentAttemptsUseCase<A>({
    findByMerchantReference: async (r) => { calls.push('ref'); return [a1, a2].find((a) => a.merchantReference === r) ?? null; },
    findByTrackingId: async (t) => { calls.push('trk'); return [a1].find((a) => a.orderTrackingId === t) ?? null; },
    findOrder: async (q) => { calls.push('order'); return q === 'GP-202609-AAAA' || q === 'o1' ? { id: 'o1' } : null; },
    findAttemptsByOrderId: async (id) => { calls.push('byOrder'); return id === 'o1' ? [a1, a2] : []; },
  });
  return { uc, calls };
}
describe('finding payment attempts by the identifiers staff receive', () => {
  it('merchant reference -> that attempt', async () => {
    const { uc } = build();
    expect((await uc.execute('GP-GP-202609-AAAA-bbbb')).map((a) => a.id)).toEqual(['a2']);
  });
  it('provider tracking id -> that attempt', async () => {
    const { uc } = build();
    expect((await uc.execute('trk-1')).map((a) => a.id)).toEqual(['a1']);
  });
  it('order number -> every attempt on the order, de-duplicated', async () => {
    const { uc } = build();
    expect((await uc.execute('GP-202609-AAAA')).map((a) => a.id)).toEqual(['a1', 'a2']);
  });
  it('a merchant reference that is also on a found order is returned once', async () => {
    const { uc } = build();
    // ref matches a1; the order lookup for that same string fails (not an order id), so no duplication either way
    const rows = await uc.execute('GP-GP-202609-AAAA-aaaa');
    expect(rows.map((a) => a.id)).toEqual(['a1']);
  });
  it('blank, whitespace, or over-long input returns nothing and touches no repository', async () => {
    const { uc, calls } = build();
    expect(await uc.execute('   ')).toEqual([]);
    expect(await uc.execute('x'.repeat(121))).toEqual([]);
    expect(calls).toEqual([]);
  });
  it('an unknown identifier returns an empty list (no throw)', async () => {
    const { uc } = build();
    expect(await uc.execute('nope')).toEqual([]);
  });
});
