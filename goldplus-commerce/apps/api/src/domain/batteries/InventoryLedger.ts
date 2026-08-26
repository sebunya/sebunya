import { MOVEMENT_TYPES, type MovementType } from '@goldplus/shared';

/**
 * Inventory movement rules. Pure domain. Every stock change is a movement with
 * a type, a signed quantity, a reason and an actor; the balance after it is
 * never negative. Receipts add, damage and loss remove, counts and corrections
 * set the balance and record the difference.
 */

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value);
}

export interface MovementRequest {
  movementType: MovementType;
  /** For ADD/REMOVE types: the positive quantity moved. For COUNT: the counted balance. */
  quantity: number;
  reason: string;
  supplierName?: string | null;
  referenceNumber?: string | null;
  unitCostUgx?: number | null;
}

export type MovementPlan =
  | { ok: true; delta: number; reason: string }
  | { ok: false; code: 'BAD_INPUT' | 'REASON_REQUIRED' | 'SUPPLIER_REQUIRED'; message: string };

/** Types whose quantity is added to stock. */
const ADDING: ReadonlySet<MovementType> = new Set<MovementType>(['OPENING', 'RECEIPT', 'RETURN']);
/** Types whose quantity is removed from stock. */
const REMOVING: ReadonlySet<MovementType> = new Set<MovementType>(['DAMAGED', 'LOST']);

/** Turn a request into a signed delta the row-locked adjuster applies. */
export function planMovement(req: MovementRequest, currentStock: number): MovementPlan {
  if (!Number.isInteger(req.quantity)) return { ok: false, code: 'BAD_INPUT', message: 'Quantity must be a whole number.' };
  const reason = (req.reason ?? '').trim();
  if (!reason) return { ok: false, code: 'REASON_REQUIRED', message: 'A reason is required for every stock movement.' };
  if (req.unitCostUgx != null && (!Number.isInteger(req.unitCostUgx) || req.unitCostUgx < 0)) {
    return { ok: false, code: 'BAD_INPUT', message: 'Unit cost must be a whole number of shillings, zero or more.' };
  }
  switch (req.movementType) {
    case 'OPENING':
    case 'RECEIPT':
    case 'RETURN':
      if (req.quantity < 0) return { ok: false, code: 'BAD_INPUT', message: `${req.movementType} quantity cannot be negative.` };
      if (req.movementType === 'RECEIPT' && !(req.supplierName ?? '').trim()) return { ok: false, code: 'SUPPLIER_REQUIRED', message: 'A receipt needs the supplier.' };
      return { ok: true, delta: req.quantity, reason };
    case 'DAMAGED':
    case 'LOST':
      if (req.quantity <= 0) return { ok: false, code: 'BAD_INPUT', message: `${req.movementType} quantity must be greater than zero.` };
      return { ok: true, delta: -req.quantity, reason };
    case 'COUNT':
    case 'CORRECTION':
      if (req.quantity < 0) return { ok: false, code: 'BAD_INPUT', message: 'A counted balance cannot be negative.' };
      return { ok: true, delta: req.quantity - currentStock, reason };
    case 'ADJUSTMENT':
      if (req.quantity === 0) return { ok: false, code: 'BAD_INPUT', message: 'An adjustment of zero changes nothing.' };
      return { ok: true, delta: req.quantity, reason };
    default:
      return { ok: false, code: 'BAD_INPUT', message: 'Unknown movement type.' };
  }
}

export function isAddingType(t: MovementType): boolean { return ADDING.has(t); }
export function isRemovingType(t: MovementType): boolean { return REMOVING.has(t); }

export interface ReceiptLineInput {
  productId: string | null;
  scannedCode: string | null;
  quantity: number;
  unitCostUgx: number | null;
  matchKind: 'EXISTING' | 'NEW' | 'AMBIGUOUS';
}

/** A receipt applies only when every line resolves to exactly one product. */
export function receiptBlockers(lines: ReceiptLineInput[]): string[] {
  const errors: string[] = [];
  if (!lines.length) errors.push('A receipt needs at least one line.');
  lines.forEach((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) errors.push(`Line ${i + 1}: quantity must be a whole number greater than zero.`);
    if (l.matchKind === 'AMBIGUOUS') errors.push(`Line ${i + 1}: "${l.scannedCode ?? ''}" matches more than one battery; pick one.`);
    if (l.matchKind === 'NEW' && !l.productId) errors.push(`Line ${i + 1}: "${l.scannedCode ?? ''}" is a new battery; create its draft before applying.`);
    if (l.matchKind === 'EXISTING' && !l.productId) errors.push(`Line ${i + 1}: no product linked.`);
    if (l.unitCostUgx != null && (!Number.isInteger(l.unitCostUgx) || l.unitCostUgx < 0)) errors.push(`Line ${i + 1}: unit cost must be zero or more.`);
  });
  return errors;
}

export interface CountLineInput {
  productId: string;
  systemQuantity: number;
  countedQuantity: number;
  reason: string | null;
}

/** Any line whose count differs from the system needs a reason. */
export function countBlockers(lines: CountLineInput[]): string[] {
  const errors: string[] = [];
  if (!lines.length) errors.push('A count needs at least one line.');
  lines.forEach((l, i) => {
    if (!Number.isInteger(l.countedQuantity) || l.countedQuantity < 0) errors.push(`Line ${i + 1}: counted quantity must be zero or more.`);
    if (l.countedQuantity !== l.systemQuantity && !(l.reason ?? '').trim()) errors.push(`Line ${i + 1}: the count differs from the system by ${l.countedQuantity - l.systemQuantity}; a reason is required.`);
  });
  return errors;
}
