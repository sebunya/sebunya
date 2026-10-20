import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANGE_OF_MIND_DAYS, RequestReturnUseCase } from '../../apps/api/src/application/use-cases/commerce/RequestReturnUseCase';

const NOW = new Date('2026-10-20T12:00:00Z');
const order = (status = 'delivered') => ({
  orderNumber: 'GP-202610-ABC', customerPhone: '+256700000001', orderStatus: status, customerName: 'Amina',
  items: [{ productId: 'p1', name: 'GoldPlus GP-P06 Power Bank' }],
});
function setup(daysAgo: number | null, lastStatus: string | null = null) {
  const opened: any[] = [];
  const uc = new RequestReturnUseCase(
    { deliveredAt: async () => (daysAgo === null ? null : new Date(NOW.getTime() - daysAgo * 86_400_000)) },
    { openTask: async (t) => { opened.push(t); return { ok: true, created: true }; }, lastTitled: async () => (lastStatus ? { status: lastStatus } : null) },
    () => NOW,
  );
  return { uc, opened };
}
const ask = (o: Partial<{ productId: string; reason: string; preference: string; detail: string }> = {}) =>
  ({ productId: 'p1', reason: 'faulty', preference: 'bring_to_shop', detail: 'It stopped charging after two days', ...o });

describe('self-service returns (gap #8)', () => {
  it('a delivered order item becomes one Care Desk task with everything staff need', async () => {
    const { uc, opened } = setup(3);
    expect(await uc.execute(order(), ask())).toEqual({ ok: true, created: true });
    expect(opened[0]).toMatchObject({ kind: 'order_problem', title: 'Return GP-202610-ABC: GoldPlus GP-P06 Power Bank', orderNumber: 'GP-202610-ABC', customerPhone: '+256700000001', customerName: 'Amina' });
    expect(opened[0].detail).toContain('Reason: It does not work properly');
    expect(opened[0].detail).toContain('How it comes back: I will bring it to the shop');
    expect(opened[0].detail).toContain('(3 days ago)');
    expect(opened[0].proposedAction).toMatchObject({ type: 'return', reason: 'faulty', daysSinceDelivery: 3 });
  });

  it(`a change of mind is accepted within ${CHANGE_OF_MIND_DAYS} days only; a fault is always taken`, async () => {
    expect(await setup(13).uc.execute(order(), ask({ reason: 'changed_mind', detail: '' }))).toMatchObject({ ok: true });
    expect(await setup(15).uc.execute(order(), ask({ reason: 'changed_mind', detail: '' }))).toEqual({ ok: false, reason: 'PAST_CHANGE_OF_MIND' });
    expect(await setup(200).uc.execute(order(), ask({ reason: 'faulty' }))).toMatchObject({ ok: true });
  });

  it('refuses what the policy does not cover', async () => {
    const { uc, opened } = setup(1);
    expect(await uc.execute(order('dispatched'), ask())).toEqual({ ok: false, reason: 'NOT_DELIVERED' });
    expect(await uc.execute(order(), ask({ productId: 'other' }))).toEqual({ ok: false, reason: 'NOT_ON_ORDER' });
    expect(await uc.execute(order(), ask({ reason: 'refund-now' }))).toEqual({ ok: false, reason: 'BAD_REASON' });
    expect(await uc.execute(order(), ask({ preference: 'post' }))).toEqual({ ok: false, reason: 'BAD_PREFERENCE' });
    expect(await uc.execute(order(), ask({ detail: 'broken' }))).toEqual({ ok: false, reason: 'NEEDS_DETAIL' });
    expect(opened).toHaveLength(0);
  });

  it('a second request for the same item while one is open opens nothing new', async () => {
    const { uc, opened } = setup(2, 'open');
    expect(await uc.execute(order(), ask())).toEqual({ ok: true, created: false });
    expect(opened).toHaveLength(0);
  });

  it('the route uses the same order proof as tracking, and pages link to the form', () => {
    const r = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
    expect(r('apps/api/src/interfaces/http/routes/commerce.ts')).toMatch(/routes\.post\('\/orders\/return-request'[\s\S]{0,200}verifyOrderRequest\(c\)/);
    expect(r('apps/web/src/pages/returns.astro')).toContain('href="/returns/start"');
    expect(r('apps/web/src/pages/orders/[id].astro')).toContain('/returns/start?reference=${encodeURIComponent(order.orderNumber)}');
  });
});
