import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { products, categories } from '../infrastructure/db/schema/products';
import { orders } from '../infrastructure/db/schema/commerce';
import { inventoryReservations } from '../infrastructure/db/schema/inventory';
import { fulfilmentTasks, fulfilmentDispatches } from '../infrastructure/db/schema/fulfilment';
import { DrizzleInventoryRepository } from '../infrastructure/db/repositories/DrizzleInventoryRepository';
import { DrizzleFulfilmentRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentRepository';
import { DrizzleFulfilmentDispatchRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentDispatchRepository';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { ConsumeInventoryForOrderUseCase } from '../application/use-cases/inventory/InventoryUseCases';
import { RecordDispatchUseCase } from '../application/use-cases/fulfilment/DispatchUseCases';
import { FulfilmentTask } from '../domain/fulfilment/FulfilmentTask';
import { eq } from 'drizzle-orm';

/**
 * Real-PostgreSQL proof (F4): inventory is consumed EXACTLY ONCE and a duplicate
 * dispatch neither re-consumes stock nor creates a second record. Also proves the
 * ON_HOLD and unpaid (no cash-on-delivery) rejections. Refuses to run in production.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  const catId = randomUUID();
  const prodId = randomUUID();
  const INITIAL_STOCK = 10;
  const RESERVE = 4;
  await db.insert(categories).values({ id: catId, name: `dsp-${catId.slice(0, 8)}`, slug: `dsp-${catId.slice(0, 8)}` });
  await db.insert(products).values({
    id: prodId, sku: `DSP-${prodId.slice(0, 8)}`, modelNumber: 'M', name: 'Dispatch Widget',
    slug: `dsp-${prodId.slice(0, 8)}`, categoryId: catId, shortDescription: 'x',
    approvalStatus: 'approved', hasRetailPrice: true, stockQuantity: INITIAL_STOCK, reservedQuantity: 0, reorderPoint: 0,
  });

  const orderId = randomUUID();
  await db.insert(orders).values({
    id: orderId, orderNumber: `DSP-${orderId.slice(0, 6)}`, customerName: 'UAT', customerPhone: '0770000000',
    deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: 1, totalAmount: 1, deliveryFee: 0,
    status: 'received', paymentStatus: 'paid',
  });

  const inventory = new DrizzleInventoryRepository();
  await inventory.reserveForOrder(orderId, [{ productId: prodId, quantity: RESERVE }]);

  // READY_FOR_DISPATCH task (paid).
  const taskId = randomUUID();
  await db.insert(fulfilmentTasks).values({
    id: taskId, orderId, orderNumber: `DSP-${taskId.slice(0, 6)}`, status: 'READY_FOR_DISPATCH', paymentStatus: 'paid',
    customerName: 'UAT', customerContactMasked: '***', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0,
    itemCount: RESERVE, items: [], priority: 'normal', slaDueAt: new Date(), slaPolicyVersion: 1,
  });

  const consume = new ConsumeInventoryForOrderUseCase(inventory);
  // Consume once at the single point (READY_FOR_DISPATCH), then again — idempotent.
  const first = await consume.execute(orderId);
  const second = await consume.execute(orderId);
  const [afterConsume] = await db.select().from(products).where(eq(products.id, prodId));

  const dispatchRepo = new DrizzleFulfilmentDispatchRepository();
  const auditRepo = new DrizzleAuditRepository();
  const record = new RecordDispatchUseCase(new DrizzleFulfilmentRepository(), dispatchRepo, inventory, auditRepo);
  const d1 = await record.execute({ taskId, actorId: randomUUID(), method: 'RIDER', contact: '0771234567' });
  const d2 = await record.execute({ taskId, actorId: randomUUID(), method: 'COURIER' }); // duplicate
  const dispatchRows = await db.select().from(fulfilmentDispatches).where(eq(fulfilmentDispatches.fulfilmentTaskId, taskId));
  const [afterDispatch] = await db.select().from(products).where(eq(products.id, prodId));

  // ON_HOLD rejection (fresh task/order, no reservation needed for the guard).
  const holdOrderId = randomUUID();
  await db.insert(orders).values({ id: holdOrderId, orderNumber: `DSH-${holdOrderId.slice(0, 6)}`, customerName: 'UAT', customerPhone: '0770000000', deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: 1, totalAmount: 1, deliveryFee: 0, status: 'received', paymentStatus: 'paid' });
  const holdTaskId = randomUUID();
  await db.insert(fulfilmentTasks).values({ id: holdTaskId, orderId: holdOrderId, orderNumber: `DSH-${holdTaskId.slice(0, 6)}`, status: 'ON_HOLD', paymentStatus: 'paid', customerName: 'UAT', customerContactMasked: '***', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, itemCount: 1, items: [], priority: 'normal', slaDueAt: new Date(), slaPolicyVersion: 1 });
  const holdResult = await record.execute({ taskId: holdTaskId, actorId: randomUUID(), method: 'RIDER' });

  // Unpaid (no cash-on-delivery) rejection.
  const unpaidOrderId = randomUUID();
  await db.insert(orders).values({ id: unpaidOrderId, orderNumber: `DSU-${unpaidOrderId.slice(0, 6)}`, customerName: 'UAT', customerPhone: '0770000000', deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: 1, totalAmount: 1, deliveryFee: 0, status: 'received', paymentStatus: 'unpaid' });
  const unpaidTaskId = randomUUID();
  await db.insert(fulfilmentTasks).values({ id: unpaidTaskId, orderId: unpaidOrderId, orderNumber: `DSU-${unpaidTaskId.slice(0, 6)}`, status: 'READY_FOR_DISPATCH', paymentStatus: 'unpaid', customerName: 'UAT', customerContactMasked: '***', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, itemCount: 1, items: [], priority: 'normal', slaDueAt: new Date(), slaPolicyVersion: 1 });
  const unpaidResult = await record.execute({ taskId: unpaidTaskId, actorId: randomUUID(), method: 'RIDER' });

  const [taskAfter] = await db.select().from(fulfilmentTasks).where(eq(fulfilmentTasks.id, taskId));

  const ok =
    first.consumed === true &&
    second.consumed === false && // idempotent — no second consumption
    afterConsume.stockQuantity === INITIAL_STOCK - RESERVE &&
    afterConsume.reservedQuantity === 0 &&
    afterDispatch.stockQuantity === INITIAL_STOCK - RESERVE && // dispatch did NOT re-consume
    d1.ok === true && (d1 as any).created === true &&
    d2.ok === true && (d2 as any).created === false &&
    dispatchRows.length === 1 &&
    dispatchRows[0].stockConsumed === true &&
    taskAfter.status === 'OUT_FOR_DELIVERY' &&
    holdResult.ok === false && (holdResult as any).code === 'TASK_ON_HOLD' &&
    unpaidResult.ok === false && (unpaidResult as any).code === 'PAYMENT_NOT_CLEARED';

  console.log(JSON.stringify({
    firstConsumed: first.consumed,
    secondConsumed: second.consumed,
    stockAfterConsume: afterConsume.stockQuantity,
    stockAfterDispatch: afterDispatch.stockQuantity,
    dispatchRecords: dispatchRows.length,
    duplicateCreated: (d2 as any).created,
    taskStatus: taskAfter.status,
    onHoldRejected: holdResult.ok === false && (holdResult as any).code,
    unpaidRejected: unpaidResult.ok === false && (unpaidResult as any).code,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  // Cleanup every row this proof created.
  await db.delete(fulfilmentDispatches).where(eq(fulfilmentDispatches.fulfilmentTaskId, taskId));
  await db.delete(fulfilmentTasks).where(eq(fulfilmentTasks.id, taskId));
  await db.delete(fulfilmentTasks).where(eq(fulfilmentTasks.id, holdTaskId));
  await db.delete(fulfilmentTasks).where(eq(fulfilmentTasks.id, unpaidTaskId));
  await db.delete(inventoryReservations).where(eq(inventoryReservations.orderId, orderId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await db.delete(orders).where(eq(orders.id, holdOrderId));
  await db.delete(orders).where(eq(orders.id, unpaidOrderId));
  await db.delete(products).where(eq(products.id, prodId));
  await db.delete(categories).where(eq(categories.id, catId));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('DISPATCH_PROOF_ERROR', e?.message);
  process.exit(1);
});
