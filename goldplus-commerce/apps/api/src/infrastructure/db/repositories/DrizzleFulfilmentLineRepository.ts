import { db } from '../client';
import { fulfilmentLines, packingSessions } from '../schema/fulfilment';
import { and, eq } from 'drizzle-orm';
import { FulfilmentLine, FulfilmentLineSnapshot } from '../../../domain/fulfilment/FulfilmentLine';
import {
  IFulfilmentLineRepository,
  FulfilmentLineInit,
  IPackingSessionRepository,
  PackingSessionSnapshot,
  PackingSessionStatus,
} from '../../../application/ports/IFulfilmentLineRepository';

function toLine(row: typeof fulfilmentLines.$inferSelect): FulfilmentLineSnapshot {
  return {
    id: row.id,
    fulfilmentTaskId: row.fulfilmentTaskId,
    orderItemId: row.orderItemId,
    productId: row.productId,
    sku: row.sku,
    orderedQuantity: row.orderedQuantity,
    reservedQuantity: row.reservedQuantity,
    packedQuantity: row.packedQuantity,
    backorderedQuantity: row.backorderedQuantity,
    cancelledQuantity: row.cancelledQuantity,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleFulfilmentLineRepository implements IFulfilmentLineRepository {
  async initialiseForTask(taskId: string, lines: FulfilmentLineInit[]): Promise<{ created: number }> {
    if (lines.length === 0) return { created: 0 };
    const inserted = await db
      .insert(fulfilmentLines)
      .values(lines.map((l) => ({
        fulfilmentTaskId: taskId,
        orderItemId: l.orderItemId,
        productId: l.productId,
        sku: l.sku,
        orderedQuantity: l.orderedQuantity,
        reservedQuantity: l.reservedQuantity,
      })))
      .onConflictDoNothing({ target: [fulfilmentLines.fulfilmentTaskId, fulfilmentLines.orderItemId] })
      .returning({ id: fulfilmentLines.id });
    return { created: inserted.length };
  }

  async findByTask(taskId: string): Promise<FulfilmentLineSnapshot[]> {
    const rows = await db.select().from(fulfilmentLines).where(eq(fulfilmentLines.fulfilmentTaskId, taskId));
    return rows.map(toLine);
  }

  async findById(lineId: string): Promise<FulfilmentLineSnapshot | null> {
    const [row] = await db.select().from(fulfilmentLines).where(eq(fulfilmentLines.id, lineId)).limit(1);
    return row ? toLine(row) : null;
  }

  async updateWithVersion(line: FulfilmentLine, expectedVersion: number): Promise<{ updated: boolean }> {
    const s = line.toSnapshot();
    const updated = await db
      .update(fulfilmentLines)
      .set({
        reservedQuantity: s.reservedQuantity,
        packedQuantity: s.packedQuantity,
        backorderedQuantity: s.backorderedQuantity,
        cancelledQuantity: s.cancelledQuantity,
        version: s.version,
        updatedAt: s.updatedAt,
      })
      .where(and(eq(fulfilmentLines.id, s.id), eq(fulfilmentLines.version, expectedVersion)))
      .returning({ id: fulfilmentLines.id });
    return { updated: updated.length > 0 };
  }
}

function toSession(row: typeof packingSessions.$inferSelect): PackingSessionSnapshot {
  return {
    id: row.id,
    fulfilmentTaskId: row.fulfilmentTaskId,
    status: row.status as PackingSessionStatus,
    packerUserId: row.packerUserId ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    packageCount: row.packageCount ?? null,
    packageReference: row.packageReference ?? null,
    packingNotes: row.packingNotes ?? null,
    exceptionReason: row.exceptionReason ?? null,
  };
}

export class DrizzlePackingSessionRepository implements IPackingSessionRepository {
  async getByTask(taskId: string): Promise<PackingSessionSnapshot | null> {
    const [row] = await db.select().from(packingSessions).where(eq(packingSessions.fulfilmentTaskId, taskId)).limit(1);
    return row ? toSession(row) : null;
  }

  async startForTask(taskId: string, packerUserId: string): Promise<PackingSessionSnapshot> {
    await db
      .insert(packingSessions)
      .values({ fulfilmentTaskId: taskId, status: 'IN_PROGRESS', packerUserId, startedAt: new Date() })
      .onConflictDoUpdate({
        target: packingSessions.fulfilmentTaskId,
        // Only (re)start a session that is not already terminal.
        set: { status: 'IN_PROGRESS', packerUserId, startedAt: new Date(), updatedAt: new Date() },
      });
    return (await this.getByTask(taskId))!;
  }

  async patch(taskId: string, patch: Partial<Omit<PackingSessionSnapshot, 'id' | 'fulfilmentTaskId'>>): Promise<void> {
    await db.update(packingSessions).set({ ...patch, updatedAt: new Date() } as any).where(eq(packingSessions.fulfilmentTaskId, taskId));
  }
}
