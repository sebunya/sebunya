/**
 * F3 — line-level fulfilment quantities (pure domain, no Drizzle/Hono).
 *
 * Truthful preparation at line level. Reserved comes from real inventory
 * reservation records (never inferred from stock-on-hand). Packing completion is
 * forbidden while any quantity is unresolved; a remainder must be explicitly
 * backordered or cancelled — never silently converted.
 */

export interface FulfilmentLineSnapshot {
  id: string;
  fulfilmentTaskId: string;
  orderItemId: string;
  productId: string;
  sku: string;
  orderedQuantity: number;
  reservedQuantity: number;
  packedQuantity: number;
  backorderedQuantity: number;
  cancelledQuantity: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type FulfilmentLineError =
  | 'INVALID_QUANTITY'
  | 'INSUFFICIENT_RESERVED_STOCK'
  | 'EXCEEDS_ORDERED'
  | 'UNRESOLVED_REMAINDER';

/** unresolved = ordered - packed - backordered - cancelled. */
export function unresolvedQuantity(s: {
  orderedQuantity: number;
  packedQuantity: number;
  backorderedQuantity: number;
  cancelledQuantity: number;
}): number {
  return s.orderedQuantity - s.packedQuantity - s.backorderedQuantity - s.cancelledQuantity;
}

function assertInvariants(s: FulfilmentLineSnapshot): void {
  const nums = [s.orderedQuantity, s.reservedQuantity, s.packedQuantity, s.backorderedQuantity, s.cancelledQuantity];
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) throw new Error('INVALID_QUANTITY');
  if (s.orderedQuantity <= 0) throw new Error('INVALID_QUANTITY');
  if (s.packedQuantity > s.reservedQuantity) throw new Error('INSUFFICIENT_RESERVED_STOCK');
  if (s.packedQuantity + s.backorderedQuantity + s.cancelledQuantity > s.orderedQuantity) throw new Error('EXCEEDS_ORDERED');
}

export class FulfilmentLine {
  private constructor(private snap: FulfilmentLineSnapshot) {}

  static rehydrate(s: FulfilmentLineSnapshot): FulfilmentLine {
    return new FulfilmentLine({ ...s });
  }

  static open(input: {
    id: string;
    fulfilmentTaskId: string;
    orderItemId: string;
    productId: string;
    sku: string;
    orderedQuantity: number;
    reservedQuantity: number;
    now?: Date;
  }): FulfilmentLine {
    const now = input.now ?? new Date();
    const snap: FulfilmentLineSnapshot = {
      id: input.id,
      fulfilmentTaskId: input.fulfilmentTaskId,
      orderItemId: input.orderItemId,
      productId: input.productId,
      sku: input.sku,
      orderedQuantity: input.orderedQuantity,
      reservedQuantity: input.reservedQuantity,
      packedQuantity: 0,
      backorderedQuantity: 0,
      cancelledQuantity: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    assertInvariants(snap);
    return new FulfilmentLine(snap);
  }

  get id(): string { return this.snap.id; }
  get version(): number { return this.snap.version; }
  toSnapshot(): FulfilmentLineSnapshot { return { ...this.snap }; }

  unresolved(): number { return unresolvedQuantity(this.snap); }
  fullyResolved(): boolean { return this.unresolved() === 0; }
  /** A line with any packed quantity contributes to partial/full fulfilment. */
  get packed(): number { return this.snap.packedQuantity; }

  /** Set the absolute packed quantity (idempotent to the target). Bounded by reserved and unresolved room. */
  setPacked(target: number, now: Date = new Date()): void {
    if (!Number.isInteger(target) || target < 0) throw new Error('INVALID_QUANTITY');
    if (target > this.snap.reservedQuantity) throw new Error('INSUFFICIENT_RESERVED_STOCK');
    // packed + backordered + cancelled must not exceed ordered.
    if (target + this.snap.backorderedQuantity + this.snap.cancelledQuantity > this.snap.orderedQuantity) {
      throw new Error('EXCEEDS_ORDERED');
    }
    this.snap = { ...this.snap, packedQuantity: target, version: this.snap.version + 1, updatedAt: now };
    assertInvariants(this.snap);
  }

  /** Backorder additional units from the current unresolved remainder. */
  backorder(quantity: number, now: Date = new Date()): void {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');
    if (quantity > this.unresolved()) throw new Error('UNRESOLVED_REMAINDER');
    this.snap = { ...this.snap, backorderedQuantity: this.snap.backorderedQuantity + quantity, version: this.snap.version + 1, updatedAt: now };
    assertInvariants(this.snap);
  }

  /** Cancel additional units from the current unresolved remainder. */
  cancel(quantity: number, now: Date = new Date()): void {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');
    if (quantity > this.unresolved()) throw new Error('UNRESOLVED_REMAINDER');
    this.snap = { ...this.snap, cancelledQuantity: this.snap.cancelledQuantity + quantity, version: this.snap.version + 1, updatedAt: now };
    assertInvariants(this.snap);
  }

  /**
   * Resume backordered units back into the unresolved pool (later fulfilment),
   * optionally increasing reserved to match a fresh reservation.
   */
  resumeBackorder(quantity: number, addReserved: number, now: Date = new Date()): void {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > this.snap.backorderedQuantity) throw new Error('INVALID_QUANTITY');
    if (!Number.isInteger(addReserved) || addReserved < 0) throw new Error('INVALID_QUANTITY');
    this.snap = {
      ...this.snap,
      backorderedQuantity: this.snap.backorderedQuantity - quantity,
      reservedQuantity: this.snap.reservedQuantity + addReserved,
      version: this.snap.version + 1,
      updatedAt: now,
    };
    assertInvariants(this.snap);
  }
}

/** Aggregate ordered/packed/backordered/cancelled across lines to derive task fulfilment. */
export type TaskFulfilmentDerivation = 'PACKING' | 'PACKED' | 'PARTIALLY_FULFILLED' | 'BACKORDERED' | 'UNSTARTED';

export function deriveTaskFulfilment(lines: FulfilmentLineSnapshot[]): TaskFulfilmentDerivation {
  if (lines.length === 0) return 'UNSTARTED';
  const totalOrdered = lines.reduce((a, l) => a + l.orderedQuantity, 0);
  const totalPacked = lines.reduce((a, l) => a + l.packedQuantity, 0);
  const totalBack = lines.reduce((a, l) => a + l.backorderedQuantity, 0);
  const totalCancel = lines.reduce((a, l) => a + l.cancelledQuantity, 0);
  const unresolved = totalOrdered - totalPacked - totalBack - totalCancel;
  if (totalPacked === 0 && totalBack === 0 && totalCancel === 0) return 'UNSTARTED';
  if (unresolved > 0) return 'PACKING';
  // Everything resolved:
  if (totalPacked === 0) return 'BACKORDERED';
  if (totalPacked === totalOrdered) return 'PACKED';
  return 'PARTIALLY_FULFILLED';
}
