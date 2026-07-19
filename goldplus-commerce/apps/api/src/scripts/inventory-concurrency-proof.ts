import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { products, categories } from '../infrastructure/db/schema/products';
import { orders } from '../infrastructure/db/schema/commerce';
import { inventoryReservations } from '../infrastructure/db/schema/inventory';
import { DrizzleInventoryRepository } from '../infrastructure/db/repositories/DrizzleInventoryRepository';
import { eq } from 'drizzle-orm';

/**
 * Real-PostgreSQL proof of the concurrent oversell guard (Section 9/14).
 * Two reservations race for the same stock; all-or-nothing + row locking must
 * ensure reserved never exceeds stock_quantity. Refuses to run in production.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  const catId = randomUUID();
  const prodId = randomUUID();
  await db.insert(categories).values({ id: catId, name: `conc-${catId.slice(0, 8)}`, slug: `conc-${catId.slice(0, 8)}` });
  await db.insert(products).values({
    id: prodId, sku: `CONC-${prodId.slice(0, 8)}`, modelNumber: 'M', name: 'Concurrency Widget',
    slug: `conc-${prodId.slice(0, 8)}`, categoryId: catId, shortDescription: 'x',
    approvalStatus: 'approved', hasRetailPrice: true, stockQuantity: 5, reservedQuantity: 0, reorderPoint: 0,
  });

  // Two orders each want 4 of a stock of 5 → at most one can win under all-or-nothing.
  const oA = randomUUID();
  const oB = randomUUID();
  const mkOrder = (id: string, key: string) =>
    db.insert(orders).values({
      id, orderNumber: `CONC-${key}`, customerName: 'UAT', customerPhone: '0770000000',
      deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: 1, totalAmount: 1, deliveryFee: 0,
      status: 'received', paymentStatus: 'unpaid',
    });
  await Promise.all([mkOrder(oA, 'A'), mkOrder(oB, 'B')]);

  const repo = new DrizzleInventoryRepository();
  const [rA, rB] = await Promise.all([
    repo.reserveForOrder(oA, [{ productId: prodId, quantity: 4 }]),
    repo.reserveForOrder(oB, [{ productId: prodId, quantity: 4 }]),
  ]);

  const [prod] = await db.select().from(products).where(eq(products.id, prodId));
  const winners = [rA, rB].filter((r) => r.fullyReserved).length;

  const ok =
    prod.reservedQuantity <= prod.stockQuantity && // never oversold
    prod.reservedQuantity === 4 && // exactly one winner held 4
    winners === 1;

  console.log(
    JSON.stringify({
      stock: prod.stockQuantity,
      reservedAfterRace: prod.reservedQuantity,
      winners,
      A_fullyReserved: rA.fullyReserved,
      B_fullyReserved: rB.fullyReserved,
      neverOversold: prod.reservedQuantity <= prod.stockQuantity,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  );

  // Cleanup this proof's rows.
  await db.delete(inventoryReservations).where(eq(inventoryReservations.productId, prodId));
  await db.delete(orders).where(eq(orders.id, oA));
  await db.delete(orders).where(eq(orders.id, oB));
  await db.delete(products).where(eq(products.id, prodId));
  await db.delete(categories).where(eq(categories.id, catId));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('CONCURRENCY_PROOF_ERROR', e?.message);
  process.exit(1);
});
