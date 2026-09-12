import { describe, it, expect } from 'vitest';
import { GetCustomerWorkspaceUseCase } from '../../apps/api/src/application/use-cases/admin/GetCustomerWorkspaceUseCase';

const d = (s: string) => new Date(s);
function build(o: { user?: any; orders?: any[]; account?: any; entries?: any[]; inbox?: any[] } = {}) {
  const uc = new GetCustomerWorkspaceUseCase({
    users: { findById: async () => o.user === undefined ? { id: 'u1', email: 'Amina@Example.com', phone: '0770', isActive: true, createdAt: d('2026-01-01') } : o.user },
    orders: { listForUser: async () => o.orders ?? [{ id: 'o1', orderNumber: 'GP-1', status: 'received', totalAmountUgx: 5000, itemCount: 1, createdAt: '2026-02-01T00:00:00Z' }, { id: 'o2', orderNumber: 'GP-2', status: 'completed', totalAmountUgx: 9000, itemCount: 2, createdAt: '2026-03-01T00:00:00Z' }] },
    loyalty: { findAccountByUserId: async () => o.account === undefined ? { id: 'acc1' } : o.account, listEntries: async () => o.entries ?? [
      { id: 'e1', accountId: 'acc1', type: 'earn', points: 100, orderId: 'o2', reason: 'Order delivered', idempotencyKey: 'k1', expiresAt: null, reversedEntryId: null, createdAt: d('2026-03-05') },
      { id: 'e2', accountId: 'acc1', type: 'redeem', points: -30, orderId: null, reason: 'Redeemed at checkout', idempotencyKey: 'k2', expiresAt: null, reversedEntryId: null, createdAt: d('2026-03-06') },
    ] },
    support: { execute: async () => o.inbox ?? [
      { ticket: { id: 't1', email: 'amina@example.com', subject: 'Charger stopped', status: 'open', priority: 'high', createdAt: d('2026-03-07') }, sla: { overdue: true } },
      { ticket: { id: 't2', email: 'someone@else.com', subject: 'Other', status: 'open', priority: 'low', createdAt: d('2026-03-07') }, sla: { overdue: false } },
    ] },
  });
  return uc;
}

describe('the customer workspace aggregates what already exists', () => {
  it('returns identity, orders (newest first), loyalty balance + entries, and only THIS customer\'s tickets', async () => {
    const ws = await build().execute('u1', d('2026-04-01'));
    expect(ws?.user).toMatchObject({ id: 'u1', email: 'Amina@Example.com', isActive: true, phoneVerified: false });
    expect(ws?.orders.map((o) => o.orderNumber)).toEqual(['GP-2', 'GP-1']);
    expect(ws?.loyalty).toMatchObject({ accountId: 'acc1', available: 70, lifetimeEarned: 100, lifetimeRedeemed: 30 });
    expect(ws?.loyalty?.entries.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(ws?.support.map((t) => t.id)).toEqual(['t1']); // email matched case-insensitively; the other customer's ticket excluded
    expect(ws?.support[0]).toMatchObject({ overdue: true, priority: 'high' });
  });
  it('unknown user -> null (the page shows not found, never a blank workspace)', async () => {
    expect(await build({ user: null }).execute('zz')).toBeNull();
  });
  it('no loyalty account -> loyalty null, everything else still present', async () => {
    const ws = await build({ account: null }).execute('u1');
    expect(ws?.loyalty).toBeNull();
    expect(ws?.orders.length).toBe(2);
  });
  it('never exposes authentication material', async () => {
    const ws = await build().execute('u1');
    expect(JSON.stringify(ws)).not.toMatch(/passwordHash|token|secret/i);
  });
});
