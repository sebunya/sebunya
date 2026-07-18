import { Order } from '../../../domain/commerce/Order';
import { ReservationOutcome } from '../../../domain/inventory/Inventory';
import { IInventoryRepository, AvailabilityRow } from '../../ports/IInventoryRepository';

/**
 * OrderPlaced → reserve stock. Idempotent (repository keys by order_id), never
 * oversells, and returns backorder warnings for the fulfilment task. A failure
 * here must not fail the order — the caller treats it as best-effort.
 */
export class ReserveInventoryForOrderUseCase {
  constructor(private readonly repo: IInventoryRepository) {}
  execute(order: Order): Promise<ReservationOutcome> {
    const lines = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    return this.repo.reserveForOrder(order.id, lines);
  }
}

/** OrderCancelled / fulfilment CANCELLED → release reservations. Idempotent. */
export class ReleaseInventoryForOrderUseCase {
  constructor(private readonly repo: IInventoryRepository) {}
  execute(orderId: string): Promise<{ released: boolean }> {
    return this.repo.releaseForOrder(orderId);
  }
}

/** Approved dispatch transition → deduct on-hand stock. Idempotent. */
export class ConsumeInventoryForOrderUseCase {
  constructor(private readonly repo: IInventoryRepository) {}
  execute(orderId: string): Promise<{ consumed: boolean }> {
    return this.repo.consumeForOrder(orderId);
  }
}

/** Admin availability lookup for specific products. */
export class GetInventoryAvailabilityUseCase {
  constructor(private readonly repo: IInventoryRepository) {}
  execute(productIds: string[]): Promise<AvailabilityRow[]> {
    return this.repo.getAvailability(productIds);
  }
}

/** Admin low-stock alert list. */
export class ListLowStockUseCase {
  constructor(private readonly repo: IInventoryRepository) {}
  execute(limit = 100): Promise<AvailabilityRow[]> {
    return this.repo.listLowStock(Math.min(Math.max(1, limit), 500));
  }
}
