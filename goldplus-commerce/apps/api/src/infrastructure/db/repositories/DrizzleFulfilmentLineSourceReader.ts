import { db } from '../client';
import { orderItems } from '../schema/commerce';
import { inventoryReservations } from '../schema/inventory';
import { eq, and } from 'drizzle-orm';
import { FulfilmentLineInit } from '../../../application/ports/IFulfilmentLineRepository';
import { IFulfilmentLineSourceReader } from '../../../application/ports/IFulfilmentLineSourceReader';

export class DrizzleFulfilmentLineSourceReader implements IFulfilmentLineSourceReader {
  async readForOrder(orderId: string): Promise<FulfilmentLineInit[]> {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    // Reserved comes from real reservation records only (never inferred from stock).
    const reservations = await db
      .select()
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, 'reserved')));
    const reservedByProduct = new Map<string, number>();
    for (const r of reservations) {
      reservedByProduct.set(r.productId, (reservedByProduct.get(r.productId) ?? 0) + r.reservedQuantity);
    }
    return items.map((i) => ({
      orderItemId: i.id,
      productId: i.productId,
      sku: i.sku,
      orderedQuantity: i.quantity,
      reservedQuantity: Math.min(i.quantity, reservedByProduct.get(i.productId) ?? 0),
    }));
  }
}
