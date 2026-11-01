import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Two operators press "reinstate" on the same cancelled task at the same
 * moment. The end state must be ONE task in NEW; the audit trail may record
 * the loser as refused, but never two divergent outcomes and never a 500.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('fulfilment reinstate under concurrency (real PostgreSQL)', () => {
  let raw: any; let orderId: string; let taskId: string; let uc: any;
  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 6, prepare: false });
    const on = `RR${Date.now().toString(36)}`.slice(0, 20);
    orderId = (await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status) values (${on}, 'Race', '0700000001', 'K', 'A', 1000, 0, 1000, 'received', 'unpaid') returning id`)[0].id;
    taskId = (await raw`insert into fulfilment_tasks (order_id, order_number, status, payment_status, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, delivery_fee_ugx, item_count, items, warnings, priority, sla_due_at, sla_policy_version) values (${orderId}, ${on}, 'CANCELLED', 'unpaid', 'Race', '07****01', 'K', 'K', 1000, 0, 1, '[]'::jsonb, '[]'::jsonb, 'STANDARD', now() + interval '1 day', 1) returning id`)[0].id;
    const { DrizzleFulfilmentRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleFulfilmentRepository');
    const { DrizzleAuditRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAuditRepository');
    const { DrizzleOrderRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository');
    const { ReinstateFulfilmentTaskUseCase } = await import('../../apps/api/src/application/use-cases/fulfilment/ReinstateFulfilmentTaskUseCase');
    uc = new ReinstateFulfilmentTaskUseCase(new DrizzleFulfilmentRepository(), new DrizzleAuditRepository(), new DrizzleOrderRepository());
  });
  afterAll(async () => { if (!raw) return; await raw`delete from audit_logs where entity_id = ${taskId}`.catch(() => undefined); await raw`delete from fulfilment_tasks where id = ${taskId}`; await raw`delete from orders where id = ${orderId}`; await raw.end(); });

  it('ten simultaneous reinstates leave exactly one NEW task and no exception', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => uc.execute({ taskId, actorId: '00000000-0000-0000-0000-000000000001' })));
    const [row] = await raw`select status, assigned_to from fulfilment_tasks where id = ${taskId}`;
    expect(row.status).toBe('NEW');
    expect(row.assigned_to).toBeNull();
    const ok = results.filter((r: any) => r.ok).length;
    const refused = results.filter((r: any) => !r.ok && r.code === 'NOT_CANCELLED').length;
    expect(ok + refused).toBe(10);
    expect(ok).toBe(1);
    expect(refused).toBe(9);
    console.log(`reinstate race: ok=${ok} refused=${refused}`);
    const tasks = await raw`select count(*)::int as n from fulfilment_tasks where order_id = ${orderId}`;
    expect(tasks[0].n).toBe(1);
  });
});
