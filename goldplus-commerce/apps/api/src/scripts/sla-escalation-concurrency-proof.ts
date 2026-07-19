import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { fulfilmentTasks, fulfilmentSlaEvents } from '../infrastructure/db/schema/fulfilment';
import { orders } from '../infrastructure/db/schema/commerce';
import { DrizzleFulfilmentRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentRepository';
import { DrizzleFulfilmentSlaEventRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentSlaEventRepository';
import { DrizzleFulfilmentTeamRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentTeamRepository';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { EvaluateFulfilmentSlaBatchUseCase } from '../application/use-cases/fulfilment/EvaluateFulfilmentSlaBatchUseCase';
import { eq } from 'drizzle-orm';

/** Real-PostgreSQL proof: concurrent SLA evaluators never duplicate escalation. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  const taskId = randomUUID();
  const orderId = randomUUID();
  const created = new Date(Date.now() - 48 * 3600_000); // 48h ago
  const due = new Date(Date.now() - 24 * 3600_000); // 24h overdue → ESCALATED
  await db.insert(orders).values({
    id: orderId, orderNumber: `SLA-${orderId.slice(0, 6)}`, customerName: 'UAT', customerPhone: '0770000000',
    deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: 1, totalAmount: 1, deliveryFee: 0, status: 'received', paymentStatus: 'unpaid',
  });
  await db.insert(fulfilmentTasks).values({
    id: taskId, orderId, orderNumber: `SLA-${taskId.slice(0, 6)}`, status: 'NEW',
    paymentStatus: 'paid', customerName: 'UAT', customerContactMasked: '***', deliveryArea: 'X',
    deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, itemCount: 1, items: [],
    priority: 'normal', slaDueAt: due, slaPolicyVersion: 1, createdAt: created, updatedAt: created,
  });

  const uc = new EvaluateFulfilmentSlaBatchUseCase(
    new DrizzleFulfilmentRepository(),
    new DrizzleFulfilmentSlaEventRepository(),
    new DrizzleFulfilmentTeamRepository(),
    new DrizzleAuditRepository()
  );

  // Two evaluators race over the same escalated task.
  const [a, b] = await Promise.all([uc.execute({}), uc.execute({})]);
  const rows = await db.select().from(fulfilmentSlaEvents).where(eq(fulfilmentSlaEvents.taskId, taskId));
  void a; void b;

  // Concurrency guarantee: exactly one escalation event for this task despite two
  // concurrent evaluators racing over it (unique idempotency key + onConflictDoNothing).
  const ok = rows.length === 1 && rows[0].stage === 'ESCALATED';
  console.log(JSON.stringify({
    eventsForTaskAfterConcurrentEvaluators: rows.length, stage: rows[0]?.stage,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  await db.delete(fulfilmentSlaEvents).where(eq(fulfilmentSlaEvents.taskId, taskId));
  await db.delete(fulfilmentTasks).where(eq(fulfilmentTasks.id, taskId));
  await db.delete(orders).where(eq(orders.id, orderId));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('SLA_PROOF_ERROR', e?.message); process.exit(1); });
