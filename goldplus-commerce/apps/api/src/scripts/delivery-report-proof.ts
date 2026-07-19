import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { orders } from '../infrastructure/db/schema/commerce';
import { fulfilmentTasks, fulfilmentDeliveries } from '../infrastructure/db/schema/fulfilment';
import { DrizzleFulfilmentRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentRepository';
import { DrizzleFulfilmentDeliveryRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentDeliveryRepository';
import { DrizzleFulfilmentReportRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentReportRepository';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { RecordDeliveryUseCase } from '../application/use-cases/fulfilment/DeliveryUseCases';
import { eq } from 'drizzle-orm';

/**
 * Real-PostgreSQL proof (F5): a failed attempt leaves the task dispatched and
 * increments the attempt; a DELIVERED outcome completes the task WITHOUT changing
 * payment; the pipeline report reflects both; a resubmitted attempt is idempotent.
 * Refuses to run in production.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  const orderId = randomUUID();
  const taskId = randomUUID();
  await db.insert(orders).values({
    id: orderId, orderNumber: `DL-${orderId.slice(0, 6)}`, customerName: 'UAT', customerPhone: '0770000000',
    deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: 1, totalAmount: 1, deliveryFee: 0,
    status: 'received', paymentStatus: 'unpaid',
  });
  await db.insert(fulfilmentTasks).values({
    id: taskId, orderId, orderNumber: `DL-${taskId.slice(0, 6)}`, status: 'OUT_FOR_DELIVERY', paymentStatus: 'unpaid',
    customerName: 'UAT', customerContactMasked: '***', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0,
    itemCount: 2, items: [], priority: 'normal', slaDueAt: new Date(), slaPolicyVersion: 1,
  });

  const tasks = new DrizzleFulfilmentRepository();
  const deliveries = new DrizzleFulfilmentDeliveryRepository();
  const reports = new DrizzleFulfilmentReportRepository();
  const record = new RecordDeliveryUseCase(tasks, deliveries, new DrizzleAuditRepository());

  const before = await reports.buildReport(new Date());

  // Attempt 1: failed → task stays OUT_FOR_DELIVERY.
  const failed = await record.execute({ taskId, actorId: randomUUID(), outcome: 'DELIVERY_FAILED', failedReason: 'customer not home' });
  const [afterFail] = await db.select().from(fulfilmentTasks).where(eq(fulfilmentTasks.id, taskId));

  // Attempt 2: delivered → task DELIVERED, payment untouched.
  const delivered = await record.execute({ taskId, actorId: randomUUID(), outcome: 'DELIVERED', recipientName: 'Nakato Jane', proofReference: 'POD-1' });
  const [afterDeliver] = await db.select().from(fulfilmentTasks).where(eq(fulfilmentTasks.id, taskId));
  const [orderAfter] = await db.select().from(orders).where(eq(orders.id, orderId));

  // Idempotent resubmission of attempt 1 at the repository boundary.
  const dupe = await deliveries.create({
    fulfilmentTaskId: taskId, orderId, attempt: 1, outcome: 'DELIVERY_FAILED', deliveredAt: null,
    recipientNameMasked: null, recipientConfirmation: null, proofReference: null, failedReason: 'again',
    rescheduledFor: null, deliveredQuantity: 0, returnedQuantity: 0, notes: null,
  });
  const rows = await deliveries.listByTask(taskId);

  const after = await reports.buildReport(new Date());

  const ok =
    failed.ok === true && (failed as any).completed === false &&
    afterFail.status === 'OUT_FOR_DELIVERY' &&
    delivered.ok === true && (delivered as any).completed === true &&
    afterDeliver.status === 'DELIVERED' &&
    orderAfter.paymentStatus === 'unpaid' && // no auto payment completion
    dupe.created === false && rows.length === 2 && // idempotent attempt, exactly two rows
    after.delivery.delivered === before.delivery.delivered + 1 &&
    after.delivery.failed === before.delivery.failed + 1 &&
    after.cycleTime.deliveredCount === before.cycleTime.deliveredCount + 1;

  console.log(JSON.stringify({
    failedCompleted: (failed as any).completed,
    statusAfterFail: afterFail.status,
    deliveredCompleted: (delivered as any).completed,
    statusAfterDeliver: afterDeliver.status,
    paymentUnchanged: orderAfter.paymentStatus === 'unpaid',
    duplicateCreated: dupe.created,
    attemptRows: rows.length,
    reportDeliveredDelta: after.delivery.delivered - before.delivery.delivered,
    reportFailedDelta: after.delivery.failed - before.delivery.failed,
    cycleTimeCountDelta: after.cycleTime.deliveredCount - before.cycleTime.deliveredCount,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  await db.delete(fulfilmentDeliveries).where(eq(fulfilmentDeliveries.fulfilmentTaskId, taskId));
  await db.delete(fulfilmentTasks).where(eq(fulfilmentTasks.id, taskId));
  await db.delete(orders).where(eq(orders.id, orderId));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('DELIVERY_PROOF_ERROR', e?.message);
  process.exit(1);
});
