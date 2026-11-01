import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import { mediaImportRows, mediaImportSessions } from '../schema/mediaImports';
import type { ApplyRowStatus, IMediaImportRepository, MediaImportRowRecord, MediaImportSessionRecord, MediaImportStatus } from '../../../application/ports/IMediaImportRepository';
import type { ImportPlan, ImportRowStatus, ProductPlan } from '../../../domain/media/MediaImportPlanner';
import type { SlotMap } from '../../../domain/media/ProductMediaSlotMap';

function toSession(r: typeof mediaImportSessions.$inferSelect): MediaImportSessionRecord {
  return {
    id: r.id, name: r.name, status: r.status as MediaImportStatus, version: r.version, importerVersion: r.importerVersion, manifestSha256: r.manifestSha256, manifestFilename: r.manifestFilename,
    planHash: r.planHash, totals: (r.totals as Record<string, number>) ?? {}, blocking: r.blocking, createdBy: r.createdBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt, rejectedReason: r.rejectedReason,
    appliedBy: r.appliedBy, appliedAt: r.appliedAt, applySummary: (r.applySummary as Record<string, unknown> | null) ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function toRow(r: typeof mediaImportRows.$inferSelect): MediaImportRowRecord {
  return {
    id: r.id, sessionId: r.sessionId, rowNumber: r.rowNumber, filename: r.filename, sha256: r.sha256, assetId: r.assetId, skuToken: r.skuToken, productId: r.productId, productSku: r.productSku,
    slot: (r.slot ?? null) as MediaImportRowRecord['slot'], role: r.role, altText: r.altText, source: r.source as 'FILENAME' | 'MANIFEST', status: r.status as ImportRowStatus, issues: (r.issues as string[]) ?? [],
    expectedRevision: r.expectedRevision, currentMap: (r.currentMap as SlotMap | null) ?? null, proposedMap: (r.proposedMap as SlotMap | null) ?? null,
    applyStatus: (r.applyStatus as ApplyRowStatus | null) ?? null, appliedRevision: r.appliedRevision, appliedAt: r.appliedAt, error: r.error,
  };
}

export class DrizzleMediaImportRepository implements IMediaImportRepository {
  async create(input: { name: string; plan: ImportPlan; manifestSha256: string | null; manifestFilename: string | null; actorId: string }): Promise<MediaImportSessionRecord> {
    return db.transaction(async (tx) => {
      const [session] = await tx.insert(mediaImportSessions).values({
        name: input.name, status: 'PLANNED', importerVersion: input.plan.importerVersion, manifestSha256: input.manifestSha256, manifestFilename: input.manifestFilename,
        planHash: input.plan.planHash, totals: input.plan.totals, blocking: input.plan.blocking, createdBy: input.actorId,
      }).returning();
      const byProduct = new Map(input.plan.products.map((p) => [p.productId, p]));
      if (input.plan.rows.length) {
        await tx.insert(mediaImportRows).values(input.plan.rows.map((r) => {
          const p = r.productId ? byProduct.get(r.productId) : undefined;
          return {
            sessionId: session.id, rowNumber: r.rowNumber, filename: r.filename, sha256: r.sha256, assetId: r.assetId, skuToken: r.skuToken, productId: r.productId, productSku: r.productSku,
            slot: r.slot, role: r.role, altText: r.altText, source: r.source, status: r.status, issues: r.issues,
            expectedRevision: p?.expectedRevision ?? null, currentMap: p?.currentMap ?? null, proposedMap: p?.proposedMap ?? null,
          };
        }));
      }
      return toSession(session);
    });
  }

  async list(limit: number): Promise<MediaImportSessionRecord[]> {
    const rows = await db.select().from(mediaImportSessions).orderBy(desc(mediaImportSessions.createdAt)).limit(Math.max(1, Math.min(limit, 200)));
    return rows.map(toSession);
  }

  async find(id: string): Promise<MediaImportSessionRecord | null> {
    const row = await db.query.mediaImportSessions.findFirst({ where: eq(mediaImportSessions.id, id) });
    return row ? toSession(row) : null;
  }

  async rows(sessionId: string): Promise<MediaImportRowRecord[]> {
    const rows = await db.select().from(mediaImportRows).where(eq(mediaImportRows.sessionId, sessionId)).orderBy(mediaImportRows.rowNumber);
    return rows.map(toRow);
  }

  async transition(id: string, expectedVersion: number, from: MediaImportStatus[], patch: Partial<Pick<MediaImportSessionRecord, 'status' | 'approvedBy' | 'approvedAt' | 'rejectedReason' | 'appliedBy' | 'appliedAt' | 'applySummary'>>): Promise<MediaImportSessionRecord | null> {
    const [row] = await db
      .update(mediaImportSessions)
      .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(mediaImportSessions.id, id), eq(mediaImportSessions.version, expectedVersion), inArray(mediaImportSessions.status, from)))
      .returning();
    return row ? toSession(row) : null;
  }

  async markRows(sessionId: string, productId: string, patch: { applyStatus: ApplyRowStatus; appliedRevision?: number | null; error?: string | null; appliedAt?: Date | null }, onlyStatuses?: ImportRowStatus[]): Promise<number> {
    const rows = await db
      .update(mediaImportRows)
      .set({ applyStatus: patch.applyStatus, appliedRevision: patch.appliedRevision ?? null, error: patch.error ?? null, appliedAt: patch.appliedAt ?? null })
      .where(and(eq(mediaImportRows.sessionId, sessionId), eq(mediaImportRows.productId, productId), onlyStatuses?.length ? inArray(mediaImportRows.status, onlyStatuses) : undefined))
      .returning({ id: mediaImportRows.id });
    return rows.length;
  }

  async productPlans(sessionId: string): Promise<ProductPlan[]> {
    const rows = await this.rows(sessionId);
    const out = new Map<string, ProductPlan>();
    for (const r of rows) {
      if (!r.productId || !r.proposedMap || r.expectedRevision === null) continue;
      if (out.has(r.productId)) continue;
      out.set(r.productId, { productId: r.productId, sku: r.productSku ?? '', expectedRevision: r.expectedRevision, currentMap: r.currentMap ?? [], proposedMap: r.proposedMap, replaces: [] });
    }
    return [...out.values()];
  }
}
