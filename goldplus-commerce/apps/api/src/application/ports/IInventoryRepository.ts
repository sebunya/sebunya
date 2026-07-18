import { ReservationLineRequest, ReservationOutcome } from '../../domain/inventory/Inventory';

export interface AvailabilityRow {
  productId: string;
  sku: string;
  name: string;
  stockOnHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  lowStock: boolean;
}

export interface IInventoryRepository {
  /**
   * Atomically reserve stock for an order. Idempotent by order_id: a second call
   * returns the existing reservation outcome (idempotentReplay=true) and never
   * double-reserves. Never reserves beyond available stock (oversell prevention);
   * any shortfall is reported as backorder.
   */
  reserveForOrder(orderId: string, lines: ReservationLineRequest[]): Promise<ReservationOutcome>;
  /** Release an order's active reservations back to available stock. Idempotent. */
  releaseForOrder(orderId: string): Promise<{ released: boolean }>;
  /** Deduct reserved stock from on-hand at dispatch and mark consumed. Idempotent. */
  consumeForOrder(orderId: string): Promise<{ consumed: boolean }>;
  /** Current availability for specific products (admin view). */
  getAvailability(productIds: string[]): Promise<AvailabilityRow[]>;
  /** Products at or below their reorder point (admin low-stock alert). */
  listLowStock(limit: number): Promise<AvailabilityRow[]>;
}
