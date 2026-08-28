import type { MovementType } from '@goldplus/shared';
import type { IInventoryLedgerRepository, MovementRecord, ReceiptRecord, CountRecord } from '../../ports/IInventoryLedgerRepository';
import type { IBatteryCatalogueRepository } from '../../ports/IBatteryCatalogueRepository';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { countBlockers, isMovementType, planMovement, receiptBlockers } from '../../../domain/batteries/InventoryLedger';
import { batteryCodeCandidates } from '../../../domain/batteries/BatteryCodes';
import { invalid, notFound, unprocessable } from './BatteryOperationError';

export const DEFAULT_STOCK_LOCATION = { code: 'MAIN', name: 'Main shop' };

export interface MovementInput {
  productId: string;
  movementType: MovementType | string;
  quantity: number;
  reason: string;
  locationCode?: string | null;
  supplierName?: string | null;
  referenceNumber?: string | null;
  unitCostUgx?: number | null;
  receiptId?: string | null;
  countId?: string | null;
  importSessionId?: string | null;
  actorId: string;
  /** Only an operator allowed to manage costs may record a unit cost. */
  canRecordCost: boolean;
}

/**
 * Every stock write in the battery module goes through here: a signed movement
 * applied by the row-locked adjuster with the ledger row in the same
 * transaction. Reasons are mandatory; negative and below-reserved balances are
 * refused by the existing inventory rules.
 */
export class InventoryLedgerUseCases {
  private readonly audit: CreateAuditLogUseCase;
  constructor(
    private readonly repo: IInventoryLedgerRepository,
    private readonly batteries: IBatteryCatalogueRepository,
    auditRepo: IAuditRepository,
  ) {
    this.audit = new CreateAuditLogUseCase(auditRepo);
  }

  listLocations() {
    return this.repo.listLocations();
  }

  async seedDefaultLocation() {
    return this.repo.ensureDefaultLocation(DEFAULT_STOCK_LOCATION.code, DEFAULT_STOCK_LOCATION.name);
  }

  private async resolveLocation(code: string | null | undefined) {
    if (code && code.trim()) {
      const loc = await this.repo.findLocationByCode(code.trim().toUpperCase());
      if (!loc || loc.status !== 'ACTIVE') throw invalid(`Unknown or archived stock location "${code}".`);
      return loc;
    }
    return this.repo.defaultLocation();
  }

  async recordMovement(input: MovementInput): Promise<{ movement: MovementRecord; before: number; after: number }> {
    if (!isMovementType(String(input.movementType))) throw invalid('Unknown movement type.');
    const type = input.movementType as MovementType;
    const stock = await this.repo.currentStock(input.productId);
    if (!stock) throw notFound('Product');
    const plan = planMovement({ movementType: type, quantity: input.quantity, reason: input.reason, supplierName: input.supplierName, referenceNumber: input.referenceNumber, unitCostUgx: input.canRecordCost ? input.unitCostUgx ?? null : null }, stock.stock);
    if (!plan.ok) throw invalid(plan.message);
    const location = await this.resolveLocation(input.locationCode);
    const outcome = await this.repo.applyMovement({
      productId: input.productId,
      locationId: location?.id ?? null,
      movementType: type,
      delta: plan.delta,
      reason: plan.reason,
      supplierName: input.supplierName?.trim() || null,
      referenceNumber: input.referenceNumber?.trim() || null,
      unitCostUgx: input.canRecordCost ? input.unitCostUgx ?? null : null,
      receiptId: input.receiptId ?? null,
      countId: input.countId ?? null,
      importSessionId: input.importSessionId ?? null,
      actorId: input.actorId,
    });
    if (!outcome.ok) throw unprocessable(outcome.code, outcome.message);
    await this.audit.execute({
      actorId: input.actorId,
      action: 'STOCK_MOVEMENT_RECORDED',
      entity: 'product',
      entityId: input.productId,
      previousState: { stockQuantity: outcome.before },
      newState: { stockQuantity: outcome.after, movementType: type, delta: plan.delta, reason: plan.reason, reference: input.referenceNumber ?? null, supplier: input.supplierName ?? null, location: location?.code ?? null, movementId: outcome.movement.id },
    });
    return { movement: outcome.movement, before: outcome.before, after: outcome.after };
  }

  async movementsFor(productId: string, canSeeCost: boolean, limit = 50) {
    const rows = await this.repo.movementsFor(productId, Math.min(limit, 200));
    return canSeeCost ? rows : rows.map((m) => ({ ...m, unitCostUgx: null }));
  }

  async recentMovements(canSeeCost: boolean, limit = 50) {
    const rows = await this.repo.recentMovements(Math.min(limit, 200));
    return canSeeCost ? rows : rows.map((m) => ({ ...m, unitCostUgx: null }));
  }

  /** Resolve a scanned or typed code to a battery for receipts and counts. */
  async matchCode(code: string): Promise<{ matchKind: 'EXISTING' | 'NEW' | 'AMBIGUOUS'; productId: string | null; canonicalCode: string | null; name: string | null; candidates: Array<{ productId: string; canonicalCode: string }> }> {
    const q = code.trim();
    if (!q) return { matchKind: 'NEW', productId: null, canonicalCode: null, name: null, candidates: [] };
    const barcode = /^\d{8,14}$/.test(q.replace(/\s+/g, '')) ? q.replace(/\s+/g, '') : null;
    const hits = await this.batteries.resolveCode(batteryCodeCandidates(q), barcode);
    const distinct = Array.from(new Map(hits.map((h) => [h.productId, h])).values());
    if (distinct.length === 1) {
      const found = await this.batteries.findByProductId(distinct[0].productId);
      return { matchKind: 'EXISTING', productId: distinct[0].productId, canonicalCode: distinct[0].canonicalCode, name: found?.product.name ?? null, candidates: [] };
    }
    if (distinct.length > 1) return { matchKind: 'AMBIGUOUS', productId: null, canonicalCode: null, name: null, candidates: distinct.map((d) => ({ productId: d.productId, canonicalCode: d.canonicalCode })) };
    return { matchKind: 'NEW', productId: null, canonicalCode: null, name: null, candidates: [] };
  }

  // -------------------------------------------------------------- receipts
  async createReceipt(input: { supplierName: string; supplierReference: string | null; locationCode: string | null; notes: string | null; createdBy: string; canRecordCost: boolean; lines: Array<{ scannedCode: string | null; productId: string | null; quantity: number; unitCostUgx: number | null; notes: string | null }> }): Promise<ReceiptRecord> {
    if (!input.supplierName.trim()) throw invalid('Supplier is required.');
    if (!input.lines.length) throw invalid('A receipt needs at least one line.');
    if (input.lines.length > 500) throw invalid('At most 500 lines per receipt.');
    const location = await this.resolveLocation(input.locationCode);
    const lines = [] as Parameters<IInventoryLedgerRepository['createReceipt']>[0]['lines'];
    for (const l of input.lines) {
      let productId = l.productId;
      let matchKind: 'EXISTING' | 'NEW' | 'AMBIGUOUS' = 'EXISTING';
      if (!productId) {
        const match = await this.matchCode(l.scannedCode ?? '');
        productId = match.productId;
        matchKind = match.matchKind;
      } else if (!(await this.batteries.findByProductId(productId))) throw invalid(`Unknown battery ${productId}.`);
      if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw invalid(`Quantity for "${l.scannedCode ?? productId}" must be a whole number greater than zero.`);
      lines.push({ productId, scannedCode: l.scannedCode, matchKind, quantity: l.quantity, unitCostUgx: input.canRecordCost ? l.unitCostUgx : null, notes: l.notes });
    }
    const receipt = await this.repo.createReceipt({ supplierName: input.supplierName.trim(), supplierReference: input.supplierReference?.trim() || null, locationId: location?.id ?? null, notes: input.notes, createdBy: input.createdBy, lines });
    await this.audit.execute({ actorId: input.createdBy, action: 'STOCK_RECEIPT_DRAFTED', entity: 'stock_receipt', entityId: receipt.id, newState: { supplier: receipt.supplierName, reference: receipt.supplierReference, lines: receipt.lines.length } });
    return receipt;
  }

  async updateReceiptLines(id: string, lines: Array<{ id?: string; scannedCode: string | null; productId: string | null; quantity: number; unitCostUgx: number | null; notes: string | null }>, actorId: string, canRecordCost: boolean) {
    const receipt = await this.repo.findReceipt(id);
    if (!receipt) throw notFound('Receipt');
    if (receipt.status !== 'DRAFT') throw unprocessable('RECEIPT_NOT_DRAFT', 'Only a draft receipt can be edited.');
    const resolved = [] as Parameters<IInventoryLedgerRepository['updateReceiptLines']>[1];
    for (const l of lines) {
      let productId = l.productId;
      let matchKind: 'EXISTING' | 'NEW' | 'AMBIGUOUS' = 'EXISTING';
      if (!productId) {
        const match = await this.matchCode(l.scannedCode ?? '');
        productId = match.productId;
        matchKind = match.matchKind;
      }
      resolved.push({ id: l.id, productId, scannedCode: l.scannedCode, matchKind, quantity: l.quantity, unitCostUgx: canRecordCost ? l.unitCostUgx : null, notes: l.notes });
    }
    const updated = await this.repo.updateReceiptLines(id, resolved);
    await this.audit.execute({ actorId, action: 'STOCK_RECEIPT_UPDATED', entity: 'stock_receipt', entityId: id, newState: { lines: resolved.length } });
    return updated;
  }

  listReceipts(canSeeCost: boolean, limit = 50) {
    return this.repo.listReceipts(Math.min(limit, 200)).then((rows) => (canSeeCost ? rows : rows.map(stripReceiptCost)));
  }

  async findReceipt(id: string, canSeeCost: boolean) {
    const r = await this.repo.findReceipt(id);
    if (!r) throw notFound('Receipt');
    return canSeeCost ? r : stripReceiptCost(r);
  }

  /** Apply = one auditable stock movement per line, all or nothing per line, refused when any line is unresolved. */
  async applyReceipt(id: string, actorId: string, canRecordCost: boolean) {
    const receipt = await this.repo.findReceipt(id);
    if (!receipt) throw notFound('Receipt');
    if (receipt.status !== 'DRAFT') throw unprocessable('RECEIPT_NOT_DRAFT', `The receipt is already ${receipt.status.toLowerCase()}.`);
    const blockers = receiptBlockers(receipt.lines.map((l) => ({ productId: l.productId, scannedCode: l.scannedCode, quantity: l.quantity, unitCostUgx: l.unitCostUgx, matchKind: l.matchKind })));
    if (blockers.length) throw unprocessable('RECEIPT_BLOCKED', blockers.join(' '), blockers);

    // Claim it before ANY stock moves. Reading the status above and then posting
    // movements is a read-then-write: a double-click on the plain HTML form, or
    // two operators on the same draft, both passed that check and both posted
    // every line, so a receipt of 20 units added 40 and the ledger disagreed
    // with the shelf. Exactly one caller can win this.
    if (!(await this.repo.claimReceiptForApply(id, actorId))) {
      throw unprocessable('RECEIPT_NOT_DRAFT', 'This receipt is already being applied.');
    }

    const location = receipt.locationId ? (await this.repo.listLocations()).find((l) => l.id === receipt.locationId) ?? null : await this.repo.defaultLocation();
    const lineMovements: Array<{ lineId: string; movementId: string }> = [];
    for (const line of receipt.lines) {
      const outcome = await this.repo.applyMovement({
        productId: line.productId!,
        locationId: location?.id ?? null,
        movementType: 'RECEIPT',
        delta: line.quantity,
        reason: `Receipt from ${receipt.supplierName}${receipt.supplierReference ? ` (${receipt.supplierReference})` : ''}`,
        supplierName: receipt.supplierName,
        referenceNumber: receipt.supplierReference,
        unitCostUgx: canRecordCost ? line.unitCostUgx : null,
        receiptId: receipt.id,
        countId: null,
        importSessionId: null,
        actorId,
      });
      if (!outcome.ok) throw unprocessable(outcome.code, `Line "${line.scannedCode ?? line.canonicalCode}": ${outcome.message}`);
      lineMovements.push({ lineId: line.id, movementId: outcome.movement.id });
    }
    const applied = await this.repo.markReceipt(id, 'APPLIED', actorId, lineMovements);
    await this.audit.execute({ actorId, action: 'STOCK_RECEIPT_APPLIED', entity: 'stock_receipt', entityId: id, previousState: { status: 'DRAFT' }, newState: { status: 'APPLIED', movements: lineMovements.length, supplier: receipt.supplierName, reference: receipt.supplierReference } });
    return applied;
  }

  async cancelReceipt(id: string, actorId: string, reason: string) {
    const receipt = await this.repo.findReceipt(id);
    if (!receipt) throw notFound('Receipt');
    if (receipt.status !== 'DRAFT') throw unprocessable('RECEIPT_NOT_DRAFT', 'Only a draft receipt can be cancelled.');
    if (!reason.trim()) throw invalid('A reason is required.');
    const updated = await this.repo.markReceipt(id, 'CANCELLED', actorId, []);
    await this.audit.execute({ actorId, action: 'STOCK_RECEIPT_CANCELLED', entity: 'stock_receipt', entityId: id, newState: { reason } });
    return updated;
  }

  // ---------------------------------------------------------------- counts
  async createCount(input: { countType: 'CYCLE' | 'FULL'; locationCode: string | null; notes: string | null; createdBy: string; lines: Array<{ productId: string; countedQuantity: number; reason: string | null }> }): Promise<CountRecord> {
    if (!input.lines.length) throw invalid('A count needs at least one line.');
    if (input.lines.length > 1000) throw invalid('At most 1000 lines per count.');
    const location = await this.resolveLocation(input.locationCode);
    const lines: Array<{ productId: string; systemQuantity: number; countedQuantity: number; reason: string | null }> = [];
    const seen = new Set<string>();
    for (const l of input.lines) {
      if (seen.has(l.productId)) throw invalid('A battery appears twice in the count.');
      seen.add(l.productId);
      const stock = await this.repo.currentStock(l.productId);
      if (!stock) throw invalid(`Unknown product ${l.productId}.`);
      lines.push({ productId: l.productId, systemQuantity: stock.stock, countedQuantity: l.countedQuantity, reason: l.reason });
    }
    const blockers = countBlockers(lines);
    if (blockers.length) throw unprocessable('COUNT_BLOCKED', blockers.join(' '), blockers);
    const count = await this.repo.createCount({ countType: input.countType, locationId: location?.id ?? null, notes: input.notes, createdBy: input.createdBy, lines });
    await this.audit.execute({ actorId: input.createdBy, action: 'STOCK_COUNT_DRAFTED', entity: 'stock_count', entityId: count.id, newState: { countType: count.countType, lines: count.lines.length } });
    return count;
  }

  listCounts(limit = 50) {
    return this.repo.listCounts(Math.min(limit, 200));
  }

  async findCount(id: string) {
    const c = await this.repo.findCount(id);
    if (!c) throw notFound('Stock count');
    return c;
  }

  /** Apply a count: one COUNT movement per line whose count differs from the live balance, re-read at apply time. */
  async applyCount(id: string, actorId: string) {
    const count = await this.repo.findCount(id);
    if (!count) throw notFound('Stock count');
    if (count.status !== 'DRAFT') throw unprocessable('COUNT_NOT_DRAFT', `The count is already ${count.status.toLowerCase()}.`);
    const blockers = countBlockers(count.lines.map((l) => ({ productId: l.productId, systemQuantity: l.systemQuantity, countedQuantity: l.countedQuantity, reason: l.reason })));
    if (blockers.length) throw unprocessable('COUNT_BLOCKED', blockers.join(' '), blockers);
    const lineMovements: Array<{ lineId: string; movementId: string }> = [];
    for (const line of count.lines) {
      const live = await this.repo.currentStock(line.productId);
      if (!live) continue;
      const delta = line.countedQuantity - live.stock;
      const outcome = await this.repo.applyMovement({
        productId: line.productId,
        locationId: count.locationId,
        movementType: 'COUNT',
        delta,
        reason: delta === 0 ? `${count.countType.toLowerCase()} count confirmed ${line.countedQuantity}` : `${count.countType.toLowerCase()} count: ${line.reason ?? 'difference found'}`,
        supplierName: null,
        referenceNumber: null,
        unitCostUgx: null,
        receiptId: null,
        countId: count.id,
        importSessionId: null,
        actorId,
      });
      if (!outcome.ok) throw unprocessable(outcome.code, `${line.canonicalCode ?? line.productId}: ${outcome.message}`);
      lineMovements.push({ lineId: line.id, movementId: outcome.movement.id });
    }
    const applied = await this.repo.markCount(id, 'APPLIED', actorId, lineMovements);
    await this.audit.execute({ actorId, action: 'STOCK_COUNT_APPLIED', entity: 'stock_count', entityId: id, previousState: { status: 'DRAFT' }, newState: { status: 'APPLIED', movements: lineMovements.length } });
    return applied;
  }

  async cancelCount(id: string, actorId: string, reason: string) {
    const count = await this.repo.findCount(id);
    if (!count) throw notFound('Stock count');
    if (count.status !== 'DRAFT') throw unprocessable('COUNT_NOT_DRAFT', 'Only a draft count can be cancelled.');
    if (!reason.trim()) throw invalid('A reason is required.');
    const updated = await this.repo.markCount(id, 'CANCELLED', actorId, []);
    await this.audit.execute({ actorId, action: 'STOCK_COUNT_CANCELLED', entity: 'stock_count', entityId: id, newState: { reason } });
    return updated;
  }
}

function stripReceiptCost(r: ReceiptRecord): ReceiptRecord {
  return { ...r, lines: r.lines.map((l) => ({ ...l, unitCostUgx: null })) };
}
