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

export interface ReservationStatusSummary {
  total: number;
  reserved: number;
  consumed: number;
  released: number;
  /** True only when there is at least one reservation and none remain merely reserved. */
  fullyConsumed: boolean;
}

export interface IInventoryRepository {
  /**
   * Atomically reserve stock for an order. Idempotent by order_id: a second call
   * returns the existing reservation outcome (idempotentReplay=true) and never
   * double-reserves. Never reserves beyond available stock (oversell prevention);
   * any shortfall is reported as backorder.
   */
  reserveForOrder(orderId: string, lines: ReservationLineRequest[]): Promise<ReservationOutcome>;
  /**
   * Sets on-hand stock atomically, refusing to write it below what is reserved.
   *
   * Returns `applied: false` with the authoritative current figures when the
   * invariant blocked the write, and `null` when the product does not exist.
   * The caller must not pre-read and decide for itself: a reservation committed
   * between that read and the write would slip straight through.
   */
  setStockQuantity(
    productId: string,
    newStock: number,
  ): Promise<{ applied: boolean; reserved: number; stock: number } | null>;
  /** Release an order's active reservations back to available stock. Idempotent. */
  releaseForOrder(orderId: string): Promise<{ released: boolean }>;
  /** Deduct reserved stock from on-hand at dispatch and mark consumed. Idempotent. */
  consumeForOrder(orderId: string): Promise<{ consumed: boolean }>;
  /** Truthful reservation-status summary for an order (drives dispatch stock-consumed flag). */
  summariseReservations(orderId: string): Promise<ReservationStatusSummary>;
  /** Current availability for specific products (admin view). */
  getAvailability(productIds: string[]): Promise<AvailabilityRow[]>;
  /** Products at or below their reorder point (admin low-stock alert). */
  listLowStock(limit: number): Promise<AvailabilityRow[]>;
}
