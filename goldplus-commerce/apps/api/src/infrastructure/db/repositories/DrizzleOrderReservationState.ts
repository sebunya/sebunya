import { eq } from 'drizzle-orm';
import { db } from '../client';
import { orders } from '../schema/commerce';
import { OrderReservationState } from '../../../domain/inventory/Inventory';
import { IOrderReservationStateWriter } from '../../../application/use-cases/inventory/ReserveInventoryForOrderUseCase';

/**
 * Records on the order what actually happened to stock.
 *
 * Kept on the order itself rather than inferred from a fulfilment task, so
 * payment initiation and fulfilment creation can both fail closed on one
 * authoritative value instead of each re-deriving it.
 */
export class DrizzleOrderReservationState implements IOrderReservationStateWriter {
  async setReservationState(orderId: string, state: OrderReservationState): Promise<void> {
    await db
      .update(orders)
      .set({ reservationState: state, reservationUpdatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }

  async getReservationState(orderId: string): Promise<OrderReservationState | null> {
    const rows = await db
      .select({ state: orders.reservationState })
      .from(orders)
      .where(eq(orders.id, orderId));
    return rows.length ? (rows[0].state as OrderReservationState) : null;
  }
}
