import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { fulfilmentTasks, fulfilmentLines } from '../infrastructure/db/schema/fulfilment';
import { orders } from '../infrastructure/db/schema/commerce';
import { FulfilmentLine } from '../domain/fulfilment/FulfilmentLine';
import { DrizzleFulfilmentLineRepository } from '../infrastructure/db/repositories/DrizzleFulfilmentLineRepository';
import { eq } from 'drizzle-orm';

/** Real-PostgreSQL proof: two packers racing one line — optimistic version lets exactly one win. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const orderId = randomUUID();
  const taskId = randomUUID();
  const lineId = randomUUID();
  await db.insert(orders).values({ id: orderId, orderNumber: `PK-${orderId.slice(0, 6)}`, customerName: 'UAT', customerPhone: '0770000000', deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: 1, totalAmount: 1, deliveryFee: 0, status: 'received', paymentStatus: 'unpaid' });
  await db.insert(fulfilmentTasks).values({ id: taskId, orderId, orderNumber: `PK-${taskId.slice(0, 6)}`, status: 'NEW', paymentStatus: 'paid', customerName: 'UAT', customerContactMasked: '***', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, itemCount: 5, items: [], priority: 'normal', slaDueAt: new Date(), slaPolicyVersion: 1 });
  await db.insert(fulfilmentLines).values({ id: lineId, fulfilmentTaskId: taskId, orderItemId: randomUUID(), productId: randomUUID(), sku: 'SKU', orderedQuantity: 5, reservedQuantity: 5, version: 0 });

  const repo = new DrizzleFulfilmentLineRepository();
  // Both packers observe the SAME base version, then submit concurrently — the
  // optimistic version guard (WHERE version = expectedVersion) lets exactly one win.
  const base = (await repo.findById(lineId))!;
  const buildPack = (qty: number) => { const l = FulfilmentLine.rehydrate(base); l.setPacked(qty); return l; };
  const [a, b] = await Promise.all([
    repo.updateWithVersion(buildPack(2), base.version),
    repo.updateWithVersion(buildPack(3), base.version),
  ]);
  const [row] = await db.select().from(fulfilmentLines).where(eq(fulfilmentLines.id, lineId));
  const winners = [a.updated, b.updated].filter(Boolean).length;
  const ok = winners === 1 && row.version === 1;
  console.log(JSON.stringify({ winners, versionAfter: row.version, packedAfter: row.packedQuantity, verdict: ok ? 'PASS' : 'FAIL' }));

  await db.delete(fulfilmentLines).where(eq(fulfilmentLines.id, lineId));
  await db.delete(fulfilmentTasks).where(eq(fulfilmentTasks.id, taskId));
  await db.delete(orders).where(eq(orders.id, orderId));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('PACKING_PROOF_ERROR', e?.message); process.exit(1); });
