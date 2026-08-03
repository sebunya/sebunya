import { eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { products } from '../schema/products';
import { IStockAdjustmentRepository, StockAdjustment } from '../../../application/use-cases/inventory/AdjustStockUseCase';

/**
 * The single writer for MANUAL stock adjustments (Wave 2E-2). Product CRUD sets
 * initial stock; reservations move reserved_quantity; this repository owns the
 * operator correction path — row-locked so a concurrent reservation cannot
 * interleave between read and write.
 */
export class DrizzleStockAdjustmentRepository implements IStockAdjustmentRepository {
  async adjust(
    productId: string,
    compute: (current: { stock: number; reserved: number }) => number,
  ): Promise<StockAdjustment | null> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ stock: products.stockQuantity, reserved: products.reservedQuantity })
        .from(products)
        .where(eq(products.id, productId))
        .for('update');
      if (!row) return null;
      const after = compute({ stock: row.stock, reserved: row.reserved });
      if (after !== row.stock) {
        await tx
          .update(products)
          .set({
            stockQuantity: after,
            // Keep the coarse display status coherent with the number the shopper sees.
            stockStatus: sql`case when ${after} <= 0 then 'out_of_stock' else 'in_stock' end`,
          })
          .where(eq(products.id, productId));
      }
      return { productId, before: row.stock, after, reserved: row.reserved };
    });
  }
}
