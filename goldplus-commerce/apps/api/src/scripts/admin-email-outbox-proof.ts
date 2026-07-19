import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { outboxEvents } from '../infrastructure/db/schema/system';
import { orders } from '../infrastructure/db/schema/commerce';
import { Order } from '../domain/commerce/Order';
import { EnqueueAdminOrderEmailUseCase } from '../application/use-cases/notifications/EnqueueAdminOrderEmailUseCase';
import { DrizzleOutboxRepository } from '../infrastructure/db/repositories/DrizzleOutboxRepository';
import { eq } from 'drizzle-orm';

/**
 * Real-PostgreSQL proof: outbox idempotency-key uniqueness under sequential and
 * concurrent duplicate admin-email enqueues, and manual replay eligibility.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const repo = new DrizzleOutboxRepository();
  const uc = new EnqueueAdminOrderEmailUseCase(repo);

  const mkOrder = (id: string) =>
    Order.create(
      id,
      { name: 'UAT Buyer', phone: '0770123456', deliveryArea: 'Ntinda', deliveryAddress: 'Plot 5' },
      'retail',
      [{ productId: randomUUID(), sku: 'SKU-1', name: 'Charger', price: 45000, quantity: 2 }],
      5000,
      true
    );

  const persistOrder = (o: Order) =>
    db.insert(orders).values({
      id: o.id, orderNumber: o.orderNumber, customerName: o.customerName, customerPhone: o.customerPhone,
      deliveryArea: o.deliveryArea, deliveryAddress: o.deliveryAddress, subtotalAmount: o.subtotalUgx,
      totalAmount: o.totalUgx, deliveryFee: o.deliveryFeeUgx, status: 'received', paymentStatus: 'unpaid',
    });

  // 1. Sequential duplicate → one row.
  const oa = mkOrder(randomUUID());
  await persistOrder(oa);
  const s1 = await uc.execute({ order: oa, event: 'placed', stockConfirmed: true });
  const s2 = await uc.execute({ order: oa, event: 'placed', stockConfirmed: true });
  const seqRows = await db.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, s1.idempotencyKey));

  // 2. Concurrent duplicate → one row.
  const ob = mkOrder(randomUUID());
  await persistOrder(ob);
  const [c1, c2] = await Promise.all([
    uc.execute({ order: ob, event: 'placed', stockConfirmed: true }),
    uc.execute({ order: ob, event: 'placed', stockConfirmed: true }),
  ]);
  const concRows = await db.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, c1.idempotencyKey));

  // 3. Replay eligibility: simulate a failed (processed + error) event, then requeue.
  await db.update(outboxEvents)
    .set({ isProcessed: true, lastError: 'Exhausted after 8 attempts.', status: 'dead_letter' })
    .where(eq(outboxEvents.idempotencyKey, s1.idempotencyKey));
  const [failedRow] = await db.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, s1.idempotencyKey));
  const replayed = await repo.requeueForReplay(failedRow.id, new Date());
  const [afterReplay] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, failedRow.id));
  // A clean (sent, no-error) event must NOT be replayable.
  await db.update(outboxEvents).set({ isProcessed: true, lastError: null }).where(eq(outboxEvents.id, failedRow.id));
  const replaySent = await repo.requeueForReplay(failedRow.id, new Date());

  const ok =
    seqRows.length === 1 && s1.enqueued && !s2.enqueued &&
    concRows.length === 1 && [c1.enqueued, c2.enqueued].filter(Boolean).length === 1 &&
    replayed === true && afterReplay.isProcessed === false && afterReplay.status === 'pending' &&
    replaySent === false;

  console.log(JSON.stringify({
    sequentialRows: seqRows.length, seqEnqueued: [s1.enqueued, s2.enqueued],
    concurrentRows: concRows.length, concEnqueued: [c1.enqueued, c2.enqueued],
    failedReplayed: replayed, statusAfterReplay: afterReplay.status,
    sentEventReplayable: replaySent,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  // Cleanup only this proof's rows.
  await db.delete(outboxEvents).where(eq(outboxEvents.idempotencyKey, s1.idempotencyKey));
  await db.delete(outboxEvents).where(eq(outboxEvents.idempotencyKey, c1.idempotencyKey));
  await db.delete(orders).where(eq(orders.id, oa.id));
  await db.delete(orders).where(eq(orders.id, ob.id));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('OUTBOX_PROOF_ERROR', e?.message); process.exit(1); });
