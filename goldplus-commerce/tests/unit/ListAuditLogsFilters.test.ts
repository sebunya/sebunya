import { describe, it, expect } from 'vitest';
import { ListAuditLogsUseCase } from '../../apps/api/src/application/use-cases/admin/ListAuditLogsUseCase';
import type { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';

/**
 * Admin maturity pass, 2026-09-12 (§24): the audit log must answer "what
 * changed on THIS record, by whom, old → new". The route exposed only `limit`;
 * the per-entity index already existed in the repository and is now reachable.
 */
const row = (o: Partial<any>) => ({
  id: o.id ?? 'a', actorId: o.actorId ?? 'u1', action: o.action ?? 'STOCK_ADJUSTED', entity: o.entity ?? 'product',
  entityId: o.entityId ?? 'p1', previousState: o.previousState ?? { stock: 1 }, newState: o.newState ?? { stock: 2 },
  createdAt: new Date('2026-09-12T10:00:00Z'),
});
function build() {
  const calls: string[] = [];
  const all = [row({ id: 'a1' }), row({ id: 'a2', actorId: 'u2', action: 'ORDER_CANCELLED', entity: 'order', entityId: 'o1' }), row({ id: 'a3', entityId: 'p2' })];
  const repo = {
    findAll: async ({ limit }: { limit: number }) => { calls.push(`all:${limit}`); return all.slice(0, limit); },
    findByEntity: async (entity: string, entityId: string) => { calls.push(`entity:${entity}:${entityId}`); return all.filter((r) => r.entity === entity && r.entityId === entityId); },
  } as unknown as IAuditRepository;
  return { uc: new ListAuditLogsUseCase(repo), calls };
}

describe('audit log filtering', () => {
  it('entity + entityId selects one record\'s history via the per-entity index', async () => {
    const { uc, calls } = build();
    const rows = await uc.execute({ entity: 'product', entityId: 'p1' });
    expect(calls).toEqual(['entity:product:p1']);
    expect(rows.map((r) => r.id)).toEqual(['a1']);
  });
  it('actor and action narrow the feed (action is case-insensitive substring)', async () => {
    const { uc } = build();
    expect((await uc.execute({ actorId: 'u2' })).map((r) => r.id)).toEqual(['a2']);
    expect((await uc.execute({ action: 'cancel' })).map((r) => r.id)).toEqual(['a2']);
  });
  it('carries old and new values so the operator sees what changed', async () => {
    const { uc } = build();
    const [first] = await uc.execute({ limit: 1 });
    expect(first.previousState).toEqual({ stock: 1 });
    expect(first.newState).toEqual({ stock: 2 });
  });
  it('caps limit at 200 and still honours it after narrowing', async () => {
    const { uc, calls } = build();
    await uc.execute({ limit: 999 });
    expect(calls[0]).toBe('all:200');
    expect((await uc.execute({ action: 'STOCK', limit: 1 })).length).toBe(1);
  });
  it('unfiltered call is unchanged for existing callers', async () => {
    const { uc, calls } = build();
    const rows = await uc.execute();
    expect(calls).toEqual(['all:50']);
    expect(rows.length).toBe(3);
  });
});
