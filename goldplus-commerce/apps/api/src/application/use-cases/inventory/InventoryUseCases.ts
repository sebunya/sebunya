import { IInventoryRepository, AvailabilityRow } from '../../ports/IInventoryRepository';

// OrderPlaced → reserve stock. The best-effort implementation that used to live
// here has been replaced: a reservation failure is no longer indistinguishable
// from a backorder. See ReserveInventoryForOrderUseCase.
export {
  ReserveInventoryForOrderUseCase,
  type ReservationAlert,
  type ReserveInventoryDeps,
  type IOrderReservationStateWriter,
} from './ReserveInventoryForOrderUseCase';

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
