import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { products } from '../schema/products';
import { batteryProfiles, inventoryMovements, stockCountLines, stockCounts, stockLocations, stockReceiptLines, stockReceipts } from '../schema/batteries';
import type { CountRecord, IInventoryLedgerRepository, MovementOutcome, MovementRecord, MovementWrite, ReceiptRecord, StockLocationRecord } from '../../../application/ports/IInventoryLedgerRepository';
import type { MovementType } from '@goldplus/shared';

function location(r: typeof stockLocations.$inferSelect): StockLocationRecord {
  return { id: r.id, code: r.code, name: r.name, isDefault: r.isDefault, status: r.status as 'ACTIVE' | 'ARCHIVED' };
}

function movement(r: typeof inventoryMovements.$inferSelect, locationCode: string | null): MovementRecord {
  return {
    id: r.id,
    productId: r.productId,
    locationId: r.locationId,
    locationCode,
    movementType: r.movementType as MovementType,
    quantityDelta: r.quantityDelta,
    quantityBefore: r.quantityBefore,
    quantityAfter: r.quantityAfter,
    reason: r.reason,
    supplierName: r.supplierName,
    referenceNumber: r.referenceNumber,
    unitCostUgx: r.unitCostUgx,
    receiptId: r.receiptId,
    countId: r.countId,
    importSessionId: r.importSessionId,
    actorId: r.actorId,
    occurredAt: r.occurredAt,
  };
}

/**
 * The inventory ledger adapter. `applyMovement` is the ONE stock writer for the
 * battery module: it takes the same row lock the manual adjuster takes
 * (DrizzleStockAdjustmentRepository), refuses the same invariants, and inserts
 * the movement row in the same transaction, so a balance can never change
 * without its movement or vice versa.
 */
export class DrizzleInventoryLedgerRepository implements IInventoryLedgerRepository {
  async listLocations() {
    const rows = await db.select().from(stockLocations).orderBy(desc(stockLocations.isDefault), stockLocations.code);
    return rows.map(location);
  }

  async findLocationByCode(code: string) {
    const [row] = await db.select().from(stockLocations).where(eq(stockLocations.code, code)).limit(1);
    return row ? location(row) : null;
  }

  async defaultLocation() {
    const [row] = await db.select().from(stockLocations).where(eq(stockLocations.isDefault, true)).limit(1);
    return row ? location(row) : null;
  }

  async ensureDefaultLocation(code: string, name: string) {
    const existing = await this.defaultLocation();
    if (existing) return { inserted: false };
    const inserted = await db.insert(stockLocations).values({ code, name, isDefault: true }).onConflictDoNothing({ target: stockLocations.code }).returning({ id: stockLocations.id });
    return { inserted: inserted.length > 0 };
  }

  async applyMovement(write: MovementWrite): Promise<MovementOutcome> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select({ stock: products.stockQuantity, reserved: products.reservedQuantity }).from(products).where(eq(products.id, write.productId)).for('update');
      if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      const after = row.stock + write.delta;
      if (after < 0) return { ok: false, code: 'NEGATIVE_STOCK', message: `Refused: would take stock to ${after}.` };
      if (after < row.reserved) return { ok: false, code: 'BELOW_RESERVED', message: `Refused: ${row.reserved} unit(s) are reserved for open orders; stock cannot drop below that.` };
      if (after !== row.stock) {
        await tx.update(products).set({
          stockQuantity: after,
          stockStatus: sql`case when ${after} <= 0 then 'out_of_stock' else 'in_stock' end`,
          updatedAt: new Date(),
        }).where(eq(products.id, write.productId));
      }
      const [inserted] = await tx.insert(inventoryMovements).values({
        productId: write.productId,
        locationId: write.locationId,
        movementType: write.movementType,
        quantityDelta: write.delta,
        quantityBefore: row.stock,
        quantityAfter: after,
        reason: write.reason.slice(0, 500),
        supplierName: write.supplierName,
        referenceNumber: write.referenceNumber,
        unitCostUgx: write.unitCostUgx,
        receiptId: write.receiptId,
        countId: write.countId,
        importSessionId: write.importSessionId,
        actorId: write.actorId,
      }).returning();
      const [loc] = write.locationId ? await tx.select({ code: stockLocations.code }).from(stockLocations).where(eq(stockLocations.id, write.locationId)).limit(1) : [null];
      return { ok: true, movement: movement(inserted, loc?.code ?? null), before: row.stock, after, reserved: row.reserved };
    });
  }

  async movementsFor(productId: string, limit: number) {
    const rows = await db.select({ m: inventoryMovements, code: stockLocations.code }).from(inventoryMovements).leftJoin(stockLocations, eq(stockLocations.id, inventoryMovements.locationId))
      .where(eq(inventoryMovements.productId, productId)).orderBy(desc(inventoryMovements.occurredAt)).limit(limit);
    return rows.map((r) => movement(r.m, r.code));
  }

  async recentMovements(limit: number) {
    const rows = await db.select({ m: inventoryMovements, code: stockLocations.code, canonicalCode: batteryProfiles.canonicalCode, productName: products.name })
      .from(inventoryMovements)
      .leftJoin(stockLocations, eq(stockLocations.id, inventoryMovements.locationId))
      .innerJoin(products, eq(products.id, inventoryMovements.productId))
      .leftJoin(batteryProfiles, eq(batteryProfiles.productId, inventoryMovements.productId))
      .orderBy(desc(inventoryMovements.occurredAt)).limit(limit);
    return rows.map((r) => ({ ...movement(r.m, r.code), canonicalCode: r.canonicalCode, productName: r.productName }));
  }

  async currentStock(productId: string) {
    const [row] = await db.select({ stock: products.stockQuantity, reserved: products.reservedQuantity }).from(products).where(eq(products.id, productId)).limit(1);
    return row ?? null;
  }

  async receiptAlreadyApplied(productId: string, referenceNumber: string | null, quantity: number) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements)
      .where(and(eq(inventoryMovements.productId, productId), eq(inventoryMovements.movementType, 'RECEIPT'), eq(inventoryMovements.quantityDelta, quantity), referenceNumber ? eq(inventoryMovements.referenceNumber, referenceNumber) : sql`${inventoryMovements.referenceNumber} IS NULL`));
    return (row?.n ?? 0) > 0;
  }

  // -------------------------------------------------------------- receipts
  private async receiptById(id: string): Promise<ReceiptRecord | null> {
    const [r] = await db.select().from(stockReceipts).where(eq(stockReceipts.id, id)).limit(1);
    if (!r) return null;
    const lines = await db.select({ l: stockReceiptLines, canonicalCode: batteryProfiles.canonicalCode, productName: products.name })
      .from(stockReceiptLines)
      .leftJoin(products, eq(products.id, stockReceiptLines.productId))
      .leftJoin(batteryProfiles, eq(batteryProfiles.productId, stockReceiptLines.productId))
      .where(eq(stockReceiptLines.receiptId, id)).orderBy(stockReceiptLines.createdAt);
    return {
      id: r.id, supplierName: r.supplierName, supplierReference: r.supplierReference, locationId: r.locationId, status: r.status as ReceiptRecord['status'], notes: r.notes,
      createdBy: r.createdBy, createdAt: r.createdAt, appliedBy: r.appliedBy, appliedAt: r.appliedAt,
      lines: lines.map((x) => ({ id: x.l.id, productId: x.l.productId, canonicalCode: x.canonicalCode, productName: x.productName, scannedCode: x.l.scannedCode, matchKind: x.l.matchKind as 'EXISTING' | 'NEW' | 'AMBIGUOUS', quantity: x.l.quantity, unitCostUgx: x.l.unitCostUgx, notes: x.l.notes, movementId: x.l.movementId })),
    };
  }

  async createReceipt(input: Parameters<IInventoryLedgerRepository['createReceipt']>[0]) {
    const id = await db.transaction(async (tx) => {
      const [r] = await tx.insert(stockReceipts).values({ supplierName: input.supplierName, supplierReference: input.supplierReference, locationId: input.locationId, notes: input.notes, createdBy: input.createdBy }).returning({ id: stockReceipts.id });
      if (input.lines.length) await tx.insert(stockReceiptLines).values(input.lines.map((l) => ({ receiptId: r.id, ...l })));
      return r.id;
    });
    return (await this.receiptById(id))!;
  }

  findReceipt(id: string) { return this.receiptById(id); }

  async listReceipts(limit: number) {
    const rows = await db.select({ id: stockReceipts.id }).from(stockReceipts).orderBy(desc(stockReceipts.createdAt)).limit(limit);
    return (await Promise.all(rows.map((r) => this.receiptById(r.id)))).filter((r): r is ReceiptRecord => !!r);
  }

  async updateReceiptLines(id: string, lines: Parameters<IInventoryLedgerRepository['updateReceiptLines']>[1]) {
    await db.transaction(async (tx) => {
      await tx.delete(stockReceiptLines).where(eq(stockReceiptLines.receiptId, id));
      if (lines.length) await tx.insert(stockReceiptLines).values(lines.map(({ id: _i, ...l }) => ({ receiptId: id, ...l })));
      await tx.update(stockReceipts).set({ updatedAt: new Date() }).where(eq(stockReceipts.id, id));
    });
    return this.receiptById(id);
  }

  async markReceipt(id: string, status: 'APPLIED' | 'CANCELLED', actorId: string, lineMovements: Array<{ lineId: string; movementId: string }>) {
    await db.transaction(async (tx) => {
      for (const lm of lineMovements) await tx.update(stockReceiptLines).set({ movementId: lm.movementId }).where(eq(stockReceiptLines.id, lm.lineId));
      await tx.update(stockReceipts).set(status === 'APPLIED' ? { status, appliedBy: actorId, appliedAt: new Date(), updatedAt: new Date() } : { status, cancelledBy: actorId, cancelledAt: new Date(), updatedAt: new Date() }).where(eq(stockReceipts.id, id));
    });
    return this.receiptById(id);
  }

  // ---------------------------------------------------------------- counts
  private async countById(id: string): Promise<CountRecord | null> {
    const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, id)).limit(1);
    if (!c) return null;
    const lines = await db.select({ l: stockCountLines, canonicalCode: batteryProfiles.canonicalCode, productName: products.name })
      .from(stockCountLines)
      .innerJoin(products, eq(products.id, stockCountLines.productId))
      .leftJoin(batteryProfiles, eq(batteryProfiles.productId, stockCountLines.productId))
      .where(eq(stockCountLines.countId, id)).orderBy(stockCountLines.createdAt);
    return {
      id: c.id, countType: c.countType as 'CYCLE' | 'FULL', locationId: c.locationId, status: c.status as CountRecord['status'], notes: c.notes,
      createdBy: c.createdBy, createdAt: c.createdAt, appliedBy: c.appliedBy, appliedAt: c.appliedAt,
      lines: lines.map((x) => ({ id: x.l.id, productId: x.l.productId, canonicalCode: x.canonicalCode, productName: x.productName, systemQuantity: x.l.systemQuantity, countedQuantity: x.l.countedQuantity, reason: x.l.reason, movementId: x.l.movementId })),
    };
  }

  async createCount(input: Parameters<IInventoryLedgerRepository['createCount']>[0]) {
    const id = await db.transaction(async (tx) => {
      const [c] = await tx.insert(stockCounts).values({ countType: input.countType, locationId: input.locationId, notes: input.notes, createdBy: input.createdBy }).returning({ id: stockCounts.id });
      if (input.lines.length) await tx.insert(stockCountLines).values(input.lines.map((l) => ({ countId: c.id, ...l })));
      return c.id;
    });
    return (await this.countById(id))!;
  }

  findCount(id: string) { return this.countById(id); }

  async listCounts(limit: number) {
    const rows = await db.select({ id: stockCounts.id }).from(stockCounts).orderBy(desc(stockCounts.createdAt)).limit(limit);
    return (await Promise.all(rows.map((r) => this.countById(r.id)))).filter((r): r is CountRecord => !!r);
  }

  async markCount(id: string, status: 'APPLIED' | 'CANCELLED', actorId: string, lineMovements: Array<{ lineId: string; movementId: string }>) {
    await db.transaction(async (tx) => {
      for (const lm of lineMovements) await tx.update(stockCountLines).set({ movementId: lm.movementId }).where(eq(stockCountLines.id, lm.lineId));
      await tx.update(stockCounts).set(status === 'APPLIED' ? { status, appliedBy: actorId, appliedAt: new Date(), updatedAt: new Date() } : { status, cancelledBy: actorId, cancelledAt: new Date(), updatedAt: new Date() }).where(eq(stockCounts.id, id));
    });
    return this.countById(id);
  }
}
