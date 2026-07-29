/**
 * Inventory ledger domain (Section 12) — pure functions, no Drizzle/Hono.
 *
 * The invariant that prevents overselling: reserved_quantity is never allowed to
 * exceed stock_quantity, so available = stock_quantity - reserved_quantity is
 * always >= 0. A reservation holds min(available, requested); any shortfall is a
 * backorder, surfaced truthfully rather than silently oversold.
 */

export type ReservationStatus = 'reserved' | 'released' | 'consumed';

export interface StockPosition {
  stockOnHand: number;
  reserved: number;
  reorderPoint: number;
}

/** Available-to-promise. Never negative. */
export function computeAvailable(stockOnHand: number, reserved: number): number {
  return Math.max(0, stockOnHand - reserved);
}

/** How much of `requested` can actually be reserved right now (never oversells). */
export function reservableQuantity(available: number, requested: number): number {
  if (requested <= 0) return 0;
  return Math.max(0, Math.min(available, requested));
}

/** Backorder shortfall = what could not be reserved. */
export function backorderShortfall(requested: number, reserved: number): number {
  return Math.max(0, requested - reserved);
}

/** Low stock when available at or below the reorder point (and a point is set). */
export function isLowStock(pos: StockPosition): boolean {
  if (pos.reorderPoint <= 0) return false;
  return computeAvailable(pos.stockOnHand, pos.reserved) <= pos.reorderPoint;
}

/**
 * Whether an operator may set on-hand stock to `newStockOnHand` while
 * `currentReserved` units are already promised to customers.
 *
 * Writing stock below what is reserved does not "free up" anything — it strands
 * reservations that were made against units the business no longer claims to
 * have. Nothing downstream reports that: `computeAvailable` clamps at zero and
 * the dispatch deduction clamps at zero, so the position reads as merely
 * out-of-stock while orders sit unfulfillable. The refusal is what makes the
 * situation visible.
 *
 * The remedy is not to force the number through. It is to release or cancel the
 * affected reservations first, which is a commercial decision about specific
 * customer orders and is not this function's to make.
 */
export type StockAdjustmentDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'NEGATIVE_STOCK' | 'RESERVED_EXCEEDS_STOCK';
      currentReserved: number;
      requestedStock: number;
      /** Units that would be promised but unbacked. */
      shortfall: number;
      message: string;
    };

export function validateStockAdjustment(
  currentReserved: number,
  newStockOnHand: number,
): StockAdjustmentDecision {
  if (!Number.isInteger(newStockOnHand) || newStockOnHand < 0) {
    return {
      allowed: false,
      reason: 'NEGATIVE_STOCK',
      currentReserved,
      requestedStock: newStockOnHand,
      shortfall: 0,
      message: 'Stock quantity must be a non-negative whole number.',
    };
  }
  if (newStockOnHand < currentReserved) {
    const shortfall = currentReserved - newStockOnHand;
    return {
      allowed: false,
      reason: 'RESERVED_EXCEEDS_STOCK',
      currentReserved,
      requestedStock: newStockOnHand,
      shortfall,
      message:
        `Cannot set stock to ${newStockOnHand}: ${currentReserved} unit(s) are already ` +
        `reserved for customer orders, so ${shortfall} unit(s) would be promised but ` +
        `unbacked. Release or cancel the affected reservations first, then set the stock.`,
    };
  }
  return { allowed: true };
}

export interface ReservationLineRequest {
  productId: string;
  quantity: number;
}

export interface ReservationLineOutcome {
  productId: string;
  requested: number;
  reserved: number;
  shortfall: number;
}

export interface ReservationOutcome {
  orderId: string;
  lines: ReservationLineOutcome[];
  fullyReserved: boolean;
  /** Human-readable backorder warnings for the fulfilment task. */
  warnings: string[];
  idempotentReplay: boolean;
}

/** Build the truthful outcome summary from per-line reserved amounts. */
export function summariseReservation(
  orderId: string,
  lines: ReservationLineOutcome[],
  idempotentReplay = false
): ReservationOutcome {
  const warnings: string[] = [];
  for (const l of lines) {
    if (l.shortfall > 0) {
      warnings.push(`Backorder: ${l.shortfall} of ${l.requested} unit(s) of product ${l.productId} are not in stock.`);
    }
  }
  return {
    orderId,
    lines,
    fullyReserved: lines.every((l) => l.shortfall === 0),
    warnings,
    idempotentReplay,
  };
}
