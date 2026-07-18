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
