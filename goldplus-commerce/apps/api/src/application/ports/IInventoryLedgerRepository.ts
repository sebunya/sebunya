import type { MovementType } from '@goldplus/shared';

export interface StockLocationRecord {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface MovementRecord {
  id: string;
  productId: string;
  locationId: string | null;
  locationCode: string | null;
  movementType: MovementType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string;
  supplierName: string | null;
  referenceNumber: string | null;
  /** Supplier cost; stripped unless the caller may read costs. */
  unitCostUgx: number | null;
  receiptId: string | null;
  countId: string | null;
  importSessionId: string | null;
  actorId: string;
  occurredAt: Date;
}

export interface MovementWrite {
  productId: string;
  locationId: string | null;
  movementType: MovementType;
  /** Signed delta the row-locked adjuster applies. */
  delta: number;
  reason: string;
  supplierName: string | null;
  referenceNumber: string | null;
  unitCostUgx: number | null;
  receiptId: string | null;
  countId: string | null;
  importSessionId: string | null;
  actorId: string;
}

export type MovementOutcome =
  | { ok: true; movement: MovementRecord; before: number; after: number; reserved: number }
  | { ok: false; code: 'NOT_FOUND' | 'NEGATIVE_STOCK' | 'BELOW_RESERVED'; message: string };

export interface ReceiptRecord {
  id: string;
  supplierName: string;
  supplierReference: string | null;
  locationId: string | null;
  status: 'DRAFT' | 'APPLIED' | 'CANCELLED';
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  appliedBy: string | null;
  appliedAt: Date | null;
  lines: Array<{
    id: string;
    productId: string | null;
    canonicalCode: string | null;
    productName: string | null;
    scannedCode: string | null;
    matchKind: 'EXISTING' | 'NEW' | 'AMBIGUOUS';
    quantity: number;
    unitCostUgx: number | null;
    notes: string | null;
    movementId: string | null;
  }>;
}

export interface CountRecord {
  id: string;
  countType: 'CYCLE' | 'FULL';
  locationId: string | null;
  status: 'DRAFT' | 'APPLIED' | 'CANCELLED';
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  appliedBy: string | null;
  appliedAt: Date | null;
  lines: Array<{
    id: string;
    productId: string;
    canonicalCode: string | null;
    productName: string | null;
    systemQuantity: number;
    countedQuantity: number;
    reason: string | null;
    movementId: string | null;
  }>;
}

export interface IInventoryLedgerRepository {
  listLocations(): Promise<StockLocationRecord[]>;
  findLocationByCode(code: string): Promise<StockLocationRecord | null>;
  defaultLocation(): Promise<StockLocationRecord | null>;
  ensureDefaultLocation(code: string, name: string): Promise<{ inserted: boolean }>;

  /**
   * Row-locked stock change + ledger row in ONE transaction. The compute
   * callback receives the current stock/reserved and returns the new balance or
   * a refusal; the movement row records before/after.
   */
  applyMovement(write: MovementWrite): Promise<MovementOutcome>;
  movementsFor(productId: string, limit: number): Promise<MovementRecord[]>;
  recentMovements(limit: number): Promise<Array<MovementRecord & { canonicalCode: string | null; productName: string }>>;
  currentStock(productId: string): Promise<{ stock: number; reserved: number } | null>;
  receiptAlreadyApplied(productId: string, referenceNumber: string | null, quantity: number): Promise<boolean>;

  createReceipt(input: { supplierName: string; supplierReference: string | null; locationId: string | null; notes: string | null; createdBy: string; lines: Array<{ productId: string | null; scannedCode: string | null; matchKind: 'EXISTING' | 'NEW' | 'AMBIGUOUS'; quantity: number; unitCostUgx: number | null; notes: string | null }> }): Promise<ReceiptRecord>;
  findReceipt(id: string): Promise<ReceiptRecord | null>;
  listReceipts(limit: number): Promise<ReceiptRecord[]>;
  updateReceiptLines(id: string, lines: Array<{ id?: string; productId: string | null; scannedCode: string | null; matchKind: 'EXISTING' | 'NEW' | 'AMBIGUOUS'; quantity: number; unitCostUgx: number | null; notes: string | null }>): Promise<ReceiptRecord | null>;
  markReceipt(id: string, status: 'APPLIED' | 'CANCELLED', actorId: string, lineMovements: Array<{ lineId: string; movementId: string }>): Promise<ReceiptRecord | null>;

  createCount(input: { countType: 'CYCLE' | 'FULL'; locationId: string | null; notes: string | null; createdBy: string; lines: Array<{ productId: string; systemQuantity: number; countedQuantity: number; reason: string | null }> }): Promise<CountRecord>;
  findCount(id: string): Promise<CountRecord | null>;
  listCounts(limit: number): Promise<CountRecord[]>;
  markCount(id: string, status: 'APPLIED' | 'CANCELLED', actorId: string, lineMovements: Array<{ lineId: string; movementId: string }>): Promise<CountRecord | null>;
}
