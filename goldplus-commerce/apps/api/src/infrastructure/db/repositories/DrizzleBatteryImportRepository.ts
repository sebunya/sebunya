import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { client, db } from '../client';
import { batteryImportEvents, batteryImportMappingTemplates, batteryImportRows, batteryImportSessions } from '../schema/batteries';
import type { IBatteryImportRepository, ImportRowRecord, ImportSessionRecord, MappingTemplateRecord, PreviewRowWrite } from '../../../application/ports/IBatteryImportRepository';
import type { BatteryImportType } from '@goldplus/shared';
import type { ImportMapping, ProposedAction } from '../../../domain/batteries/BatteryImport';

const jsonb = (value: unknown) => sql`${client.json(value as never)}::jsonb`;

function session(r: typeof batteryImportSessions.$inferSelect): ImportSessionRecord {
  return {
    ...r,
    importType: r.importType as BatteryImportType,
    sourceColumns: (r.sourceColumns as string[]) ?? [],
    mapping: (r.mapping as ImportMapping | null) ?? null,
    rollbackInfo: (r.rollbackInfo as Record<string, unknown> | null) ?? null,
  };
}

function rowRecord(r: typeof batteryImportRows.$inferSelect): ImportRowRecord {
  return {
    ...r,
    sourceData: r.sourceData as Record<string, unknown>,
    normalizedData: (r.normalizedData as Record<string, unknown> | null) ?? null,
    proposedAction: r.proposedAction as ProposedAction | 'PENDING',
    validationWarnings: (r.validationWarnings as string[]) ?? [],
    validationErrors: (r.validationErrors as string[]) ?? [],
    status: r.status as ImportRowRecord['status'],
    appliedRecordIds: (r.appliedRecordIds as Record<string, string[]> | null) ?? null,
    beforeSnapshot: (r.beforeSnapshot as Record<string, unknown> | null) ?? null,
    afterSnapshot: (r.afterSnapshot as Record<string, unknown> | null) ?? null,
  };
}

function template(r: typeof batteryImportMappingTemplates.$inferSelect): MappingTemplateRecord {
  return { id: r.id, importType: r.importType as BatteryImportType, name: r.name, mapping: r.mapping as ImportMapping, createdAt: r.createdAt };
}

export class DrizzleBatteryImportRepository implements IBatteryImportRepository {
  async event(sessionId: string, actorId: string, action: string, reason: string, evidence: Record<string, unknown>) {
    await db.insert(batteryImportEvents).values({ sessionId, actorId, action, reason, evidence: jsonb(evidence) as never });
  }

  async create(input: Parameters<IBatteryImportRepository['create']>[0]) {
    return db.transaction(async (tx) => {
      const inserted = await tx.insert(batteryImportSessions).values({
        importType: input.importType,
        name: input.name,
        sourceFilename: input.sourceFilename,
        sourceSha256: input.sourceSha256,
        sourceSheet: input.sourceSheet,
        sourceColumns: jsonb(input.sourceColumns) as never,
        mapping: input.mapping ? (jsonb(input.mapping) as never) : null,
        totalRows: input.rows.length,
        createdBy: input.actorId,
      }).onConflictDoNothing({ target: [batteryImportSessions.importType, batteryImportSessions.sourceSha256] }).returning();
      if (!inserted.length) {
        const [existing] = await tx.select().from(batteryImportSessions).where(and(eq(batteryImportSessions.importType, input.importType), eq(batteryImportSessions.sourceSha256, input.sourceSha256))).limit(1);
        return { session: session(existing), existed: true };
      }
      const s = inserted[0];
      const chunk = 200;
      for (let i = 0; i < input.rows.length; i += chunk) {
        await tx.insert(batteryImportRows).values(input.rows.slice(i, i + chunk).map((row, j) => ({ sessionId: s.id, rowNumber: i + j + 1, sourceData: jsonb(row) as never })));
      }
      await tx.insert(batteryImportEvents).values({ sessionId: s.id, actorId: input.actorId, action: 'INGESTED', reason: 'Immutable source rows ingested from the uploaded file.', evidence: jsonb({ sourceSha256: input.sourceSha256, totalRows: input.rows.length, sheet: input.sourceSheet, columns: input.sourceColumns.length }) as never });
      return { session: session(s), existed: false };
    });
  }

  async list(limit: number) {
    return (await db.select().from(batteryImportSessions).orderBy(desc(batteryImportSessions.createdAt)).limit(limit)).map(session);
  }

  async find(id: string) {
    const [row] = await db.select().from(batteryImportSessions).where(eq(batteryImportSessions.id, id)).limit(1);
    return row ? session(row) : null;
  }

  async rows(id: string) {
    return (await db.select().from(batteryImportRows).where(eq(batteryImportRows.sessionId, id)).orderBy(asc(batteryImportRows.rowNumber))).map(rowRecord);
  }

  async events(id: string) {
    const rows = await db.select().from(batteryImportEvents).where(eq(batteryImportEvents.sessionId, id)).orderBy(asc(batteryImportEvents.createdAt));
    return rows.map((r) => ({ id: r.id, action: r.action, actorId: r.actorId, reason: r.reason, evidence: (r.evidence as Record<string, unknown>) ?? {}, createdAt: r.createdAt }));
  }

  async saveMapping(id: string, expectedVersion: number, mapping: ImportMapping, templateId: string | null, actorId: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx.update(batteryImportSessions)
        .set({ mapping: jsonb(mapping) as never, mappingTemplateId: templateId, status: 'MAPPED', previewDigest: null, version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date() })
        .where(and(eq(batteryImportSessions.id, id), eq(batteryImportSessions.version, expectedVersion), inArray(batteryImportSessions.status, ['UPLOADED', 'MAPPED', 'READY_FOR_APPROVAL'])))
        .returning();
      if (!row) return null;
      await tx.update(batteryImportRows).set({ normalizedData: null, validationErrors: jsonb([]) as never, validationWarnings: jsonb([]) as never, proposedAction: 'PENDING', status: 'PENDING', rowKey: null })
        .where(and(eq(batteryImportRows.sessionId, id), inArray(batteryImportRows.status, ['PENDING', 'VALID', 'INVALID', 'HELD'])));
      await tx.insert(batteryImportEvents).values({ sessionId: id, actorId, action: 'MAPPING_SAVED', reason: 'Source-to-field mapping saved.', evidence: jsonb({ fields: Object.keys(mapping).sort(), templateId, version: row.version }) as never });
      return session(row);
    });
  }

  async savePreview(id: string, expectedVersion: number, digest: string, rows: PreviewRowWrite[], actorId: string) {
    return db.transaction(async (tx) => {
      // Keep operator resolutions from an earlier preview of the same session.
      const existing = await tx.select({ id: batteryImportRows.id, resolution: batteryImportRows.resolution, resolutionNote: batteryImportRows.resolutionNote }).from(batteryImportRows).where(eq(batteryImportRows.sessionId, id));
      const resolutions = new Map(existing.map((e) => [e.id, e.resolution]));
      let valid = 0, invalid = 0, held = 0, excluded = 0;
      for (const r of rows) {
        const resolution = resolutions.get(r.rowId);
        let status: ImportRowRecord['status'];
        if (r.errors.length) { status = 'INVALID'; invalid += 1; }
        else if (resolution === 'EXCLUDE') { status = 'EXCLUDED'; excluded += 1; }
        else if (r.hold && resolution !== 'INCLUDE') { status = 'HELD'; held += 1; }
        else if (resolution === 'HOLD') { status = 'HELD'; held += 1; }
        else { status = 'VALID'; valid += 1; }
        await tx.update(batteryImportRows).set({
          rowKey: r.rowKey.slice(0, 200) || null,
          normalizedData: r.normalizedData ? (jsonb({ ...r.normalizedData, ...(r.hold ? { hold: r.hold } : {}) }) as never) : (r.hold ? (jsonb({ hold: r.hold }) as never) : null),
          proposedAction: r.proposedAction,
          validationWarnings: jsonb(r.warnings) as never,
          validationErrors: jsonb(r.errors) as never,
          status,
          error: null,
        }).where(and(eq(batteryImportRows.id, r.rowId), eq(batteryImportRows.sessionId, id)));
      }
      const [s] = await tx.update(batteryImportSessions)
        .set({ status: 'READY_FOR_APPROVAL', previewDigest: digest, validRows: valid, invalidRows: invalid, heldRows: held, excludedRows: excluded, version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date() })
        .where(and(eq(batteryImportSessions.id, id), eq(batteryImportSessions.version, expectedVersion), inArray(batteryImportSessions.status, ['MAPPED', 'READY_FOR_APPROVAL'])))
        .returning();
      if (!s) return null;
      await tx.insert(batteryImportEvents).values({ sessionId: id, actorId, action: 'DRY_RUN_COMPLETED', reason: 'Deterministic preview completed without catalogue writes.', evidence: jsonb({ previewDigest: digest, valid, invalid, held, excluded }) as never });
      return session(s);
    });
  }

  async resolveRow(sessionId: string, rowId: string, resolution: 'INCLUDE' | 'EXCLUDE' | 'HOLD', note: string | null, override: Record<string, unknown> | null, actorId: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(batteryImportRows).where(and(eq(batteryImportRows.id, rowId), eq(batteryImportRows.sessionId, sessionId))).limit(1);
      if (!row) return null;
      const current = (row.normalizedData as Record<string, unknown> | null) ?? {};
      const merged = override ? { ...current, ...override, hold: undefined, overridden: true } : current;
      const status: ImportRowRecord['status'] = resolution === 'EXCLUDE' ? 'EXCLUDED' : resolution === 'HOLD' ? 'HELD' : (row.validationErrors as string[]).length ? 'INVALID' : 'VALID';
      let action = row.proposedAction;
      if (resolution === 'INCLUDE' && (action === 'HOLD_COMPOUND' || action === 'HOLD_CONFLICT' || action === 'HOLD_REVIEW')) {
        action = override && typeof override.proposedAction === 'string' ? String(override.proposedAction) : action === 'HOLD_REVIEW' ? 'RECEIPT' : 'CREATE_BATTERY';
      }
      const [updated] = await tx.update(batteryImportRows).set({
        resolution, resolutionNote: note, resolvedBy: actorId, resolvedAt: new Date(), status, proposedAction: action,
        normalizedData: jsonb(merged) as never,
      }).where(eq(batteryImportRows.id, rowId)).returning();
      const counts = await tx.select({
        valid: sql<number>`count(*) FILTER (WHERE status = 'VALID')::int`,
        invalid: sql<number>`count(*) FILTER (WHERE status = 'INVALID')::int`,
        held: sql<number>`count(*) FILTER (WHERE status = 'HELD')::int`,
        excluded: sql<number>`count(*) FILTER (WHERE status = 'EXCLUDED')::int`,
      }).from(batteryImportRows).where(eq(batteryImportRows.sessionId, sessionId));
      const [s] = await tx.update(batteryImportSessions).set({ validRows: counts[0].valid, invalidRows: counts[0].invalid, heldRows: counts[0].held, excludedRows: counts[0].excluded, version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date() }).where(eq(batteryImportSessions.id, sessionId)).returning();
      await tx.insert(batteryImportEvents).values({ sessionId, actorId, action: 'ROW_RESOLVED', reason: note ?? resolution, evidence: jsonb({ rowNumber: row.rowNumber, resolution, override }) as never });
      return { session: session(s), row: rowRecord(updated) };
    });
  }

  async approve(input: { id: string; expectedVersion: number; actorId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) {
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(batteryImportSessions).where(and(eq(batteryImportSessions.id, input.id), eq(batteryImportSessions.version, input.expectedVersion), eq(batteryImportSessions.status, 'READY_FOR_APPROVAL'))).limit(1);
      if (!current || !current.previewDigest) return null;
      const [row] = await tx.update(batteryImportSessions).set({
        status: input.decision, approvedBy: input.decision === 'APPROVED' ? input.actorId : null, approvedAt: input.decision === 'APPROVED' ? new Date() : null,
        version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date(),
      }).where(eq(batteryImportSessions.id, input.id)).returning();
      await tx.insert(batteryImportEvents).values({ sessionId: input.id, actorId: input.actorId, action: input.decision, reason: input.reason, evidence: jsonb({ previewDigest: current.previewDigest, validRows: current.validRows, heldRows: current.heldRows }) as never });
      return session(row);
    });
  }

  async beginApply(id: string, expectedVersion: number, actorId: string) {
    const [row] = await db.update(batteryImportSessions).set({ status: 'APPLYING', appliedBy: actorId, version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date() })
      .where(and(eq(batteryImportSessions.id, id), eq(batteryImportSessions.version, expectedVersion), eq(batteryImportSessions.status, 'APPROVED'))).returning();
    if (!row) return null;
    await this.event(id, actorId, 'APPLY_STARTED', 'Approved preview apply started.', { previewDigest: row.previewDigest });
    return session(row);
  }

  async markRowApplied(rowId: string, result: Parameters<IBatteryImportRepository['markRowApplied']>[1]) {
    await db.update(batteryImportRows).set({
      status: result.status,
      appliedRecordIds: result.appliedRecordIds ? (jsonb(result.appliedRecordIds) as never) : null,
      beforeSnapshot: result.beforeSnapshot ? (jsonb(result.beforeSnapshot) as never) : null,
      afterSnapshot: result.afterSnapshot ? (jsonb(result.afterSnapshot) as never) : null,
      appliedAt: result.status === 'APPLIED' ? new Date() : null,
      error: result.error,
    }).where(eq(batteryImportRows.id, rowId));
  }

  async finishApply(id: string, actorId: string) {
    return db.transaction(async (tx) => {
      const [counts] = await tx.select({
        applied: sql<number>`count(*) FILTER (WHERE status = 'APPLIED')::int`,
        failed: sql<number>`count(*) FILTER (WHERE status = 'FAILED')::int`,
        skipped: sql<number>`count(*) FILTER (WHERE status = 'SKIPPED')::int`,
      }).from(batteryImportRows).where(eq(batteryImportRows.sessionId, id));
      const [current] = await tx.select().from(batteryImportSessions).where(eq(batteryImportSessions.id, id)).limit(1);
      const status = counts.applied > 0 && (counts.failed > 0 || current.invalidRows > 0 || current.heldRows > 0) ? 'PARTIALLY_APPLIED' : counts.applied > 0 || counts.skipped > 0 ? 'APPLIED' : 'FAILED';
      const [row] = await tx.update(batteryImportSessions).set({ status, appliedRows: counts.applied, failedRows: counts.failed, appliedAt: new Date(), version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date() })
        .where(and(eq(batteryImportSessions.id, id), eq(batteryImportSessions.status, 'APPLYING'))).returning();
      await tx.insert(batteryImportEvents).values({ sessionId: id, actorId, action: 'APPLY_COMPLETED', reason: 'Approved preview apply completed.', evidence: jsonb({ status, applied: counts.applied, failed: counts.failed, skipped: counts.skipped, held: current.heldRows, invalid: current.invalidRows }) as never });
      return session(row);
    });
  }

  async beginRollback(id: string, expectedVersion: number, actorId: string, reason: string) {
    const [row] = await db.update(batteryImportSessions).set({ version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date() })
      .where(and(eq(batteryImportSessions.id, id), eq(batteryImportSessions.version, expectedVersion), inArray(batteryImportSessions.status, ['APPLIED', 'PARTIALLY_APPLIED']))).returning();
    if (!row) return null;
    await this.event(id, actorId, 'ROLLBACK_STARTED', reason, {});
    return session(row);
  }

  async finishRollback(id: string, actorId: string, result: { rolledBack: number; failed: number; info: Record<string, unknown> }) {
    const status = result.failed ? 'ROLLBACK_PARTIAL' : 'ROLLED_BACK';
    const [row] = await db.update(batteryImportSessions).set({ status, rollbackInfo: jsonb(result.info) as never, version: sql`${batteryImportSessions.version} + 1`, updatedAt: new Date() }).where(eq(batteryImportSessions.id, id)).returning();
    await this.event(id, actorId, 'ROLLBACK_COMPLETED', String(result.info.reason ?? 'rollback'), { status, rolledBack: result.rolledBack, failed: result.failed });
    return row ? session(row) : null;
  }

  async markRowRolledBack(rowId: string) {
    await db.update(batteryImportRows).set({ status: 'ROLLED_BACK', error: null }).where(eq(batteryImportRows.id, rowId));
  }

  async listTemplates(importType: BatteryImportType) {
    return (await db.select().from(batteryImportMappingTemplates).where(eq(batteryImportMappingTemplates.importType, importType)).orderBy(batteryImportMappingTemplates.name)).map(template);
  }

  async saveTemplate(importType: BatteryImportType, name: string, mapping: ImportMapping, actorId: string) {
    const [row] = await db.insert(batteryImportMappingTemplates).values({ importType, name, mapping: jsonb(mapping) as never, createdBy: actorId })
      .onConflictDoUpdate({ target: [batteryImportMappingTemplates.importType, batteryImportMappingTemplates.name], set: { mapping: jsonb(mapping) as never, updatedAt: new Date() } })
      .returning();
    return template(row);
  }

  async findTemplate(id: string) {
    const [row] = await db.select().from(batteryImportMappingTemplates).where(eq(batteryImportMappingTemplates.id, id)).limit(1);
    return row ? template(row) : null;
  }
}
