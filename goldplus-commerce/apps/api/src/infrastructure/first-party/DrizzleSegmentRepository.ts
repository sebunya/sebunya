import { and, asc, desc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { customerSegmentMembers, customerSegmentRuns, customerSegments } from '../db/schema/first-party';
import type { SegmentDefinition } from '../../domain/first-party/Segments';
import type { ISegmentRepository, SegmentRecord, SegmentRunRecord } from '../../application/ports/first-party/FirstPartyPorts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** jsonb may come back as the object or, from a double-encoded write, as its text. */
const asObject = <T>(v: unknown, fallback: T): T => {
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return (v ?? fallback) as T;
};

function toSegment(r: typeof customerSegments.$inferSelect): SegmentRecord {
  return {
    id: r.id, key: r.key, name: r.name, description: r.description ?? null, definition: asObject<SegmentDefinition>(r.definition, { match: 'ALL', rules: [] }),
    status: r.status as 'ACTIVE' | 'ARCHIVED', memberCount: r.memberCount ?? null, lastMaterialisedAt: r.lastMaterialisedAt ?? null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function toRun(r: typeof customerSegmentRuns.$inferSelect): SegmentRunRecord {
  return {
    id: r.id, trigger: r.trigger, status: r.status as SegmentRunRecord['status'], startedAt: r.startedAt, finishedAt: r.finishedAt ?? null,
    customersEvaluated: r.customersEvaluated ?? null, segmentsEvaluated: r.segmentsEvaluated ?? null, ordersStitched: r.ordersStitched ?? null,
    stats: asObject<Record<string, unknown>>(r.stats, {}), error: r.error ?? null,
  };
}

export class DrizzleSegmentRepository implements ISegmentRepository {
  async list(includeArchived: boolean) {
    const q = db.select().from(customerSegments);
    const r = includeArchived ? await q.orderBy(asc(customerSegments.name)) : await q.where(eq(customerSegments.status, 'ACTIVE')).orderBy(asc(customerSegments.name));
    return r.map(toSegment);
  }
  async findById(id: string) {
    if (!UUID.test(id)) return null;
    const [r] = await db.select().from(customerSegments).where(eq(customerSegments.id, id)).limit(1);
    return r ? toSegment(r) : null;
  }
  async findByKey(key: string) {
    const [r] = await db.select().from(customerSegments).where(eq(customerSegments.key, key)).limit(1);
    return r ? toSegment(r) : null;
  }
  async create(input: { key: string; name: string; description: string | null; definition: SegmentDefinition; actorId: string }) {
    const [r] = await db.insert(customerSegments).values({
      key: input.key, name: input.name, description: input.description, definition: input.definition,
      createdBy: input.actorId.slice(0, 80), updatedBy: input.actorId.slice(0, 80),
    }).returning();
    return toSegment(r);
  }
  async update(id: string, input: { name: string; description: string | null; definition: SegmentDefinition; actorId: string }) {
    if (!UUID.test(id)) return null;
    // A changed definition means the stored members are stale: the count goes
    // back to "not yet calculated" until the next run, never a wrong number.
    const [r] = await db.update(customerSegments).set({
      name: input.name, description: input.description, definition: input.definition,
      definitionVersion: sql`${customerSegments.definitionVersion} + 1`, memberCount: null, lastMaterialisedAt: null,
      updatedBy: input.actorId.slice(0, 80), updatedAt: new Date(),
    }).where(eq(customerSegments.id, id)).returning();
    return r ? toSegment(r) : null;
  }
  async setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string) {
    if (!UUID.test(id)) return false;
    const r = await db.update(customerSegments).set({ status, updatedBy: actorId.slice(0, 80), updatedAt: new Date() })
      .where(eq(customerSegments.id, id)).returning({ id: customerSegments.id });
    return r.length > 0;
  }
  async replaceMembers(segmentId: string, runId: string, canonicalIds: string[], at: Date) {
    const ids = [...new Set(canonicalIds)];
    return db.transaction(async (tx) => {
      const removed = ids.length
        ? await tx.delete(customerSegmentMembers).where(and(eq(customerSegmentMembers.segmentId, segmentId), notInArray(customerSegmentMembers.canonicalCustomerId, ids))).returning({ id: customerSegmentMembers.canonicalCustomerId })
        : await tx.delete(customerSegmentMembers).where(eq(customerSegmentMembers.segmentId, segmentId)).returning({ id: customerSegmentMembers.canonicalCustomerId });
      let added = 0;
      for (let i = 0; i < ids.length; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        const ins = await tx.insert(customerSegmentMembers).values(chunk.map((c) => ({ segmentId, canonicalCustomerId: c, firstMatchedAt: at, lastRunId: runId })))
          .onConflictDoNothing().returning({ id: customerSegmentMembers.canonicalCustomerId });
        added += ins.length;
        await tx.update(customerSegmentMembers).set({ lastRunId: runId })
          .where(and(eq(customerSegmentMembers.segmentId, segmentId), inArray(customerSegmentMembers.canonicalCustomerId, chunk)));
      }
      await tx.update(customerSegments).set({ memberCount: ids.length, lastMaterialisedAt: at, lastRunId: runId }).where(eq(customerSegments.id, segmentId));
      return { added, removed: removed.length, total: ids.length };
    });
  }
  async listMembers(segmentId: string, limit: number, afterCanonicalId?: string | null) {
    if (!UUID.test(segmentId)) return [];
    const where = afterCanonicalId && UUID.test(afterCanonicalId)
      ? and(eq(customerSegmentMembers.segmentId, segmentId), gt(customerSegmentMembers.canonicalCustomerId, afterCanonicalId))
      : eq(customerSegmentMembers.segmentId, segmentId);
    return db.select({ canonicalCustomerId: customerSegmentMembers.canonicalCustomerId, firstMatchedAt: customerSegmentMembers.firstMatchedAt })
      .from(customerSegmentMembers).where(where).orderBy(asc(customerSegmentMembers.canonicalCustomerId)).limit(limit);
  }
  async startRun(trigger: string) {
    const [r] = await db.insert(customerSegmentRuns).values({ trigger: trigger.slice(0, 24), status: 'RUNNING' }).returning({ id: customerSegmentRuns.id });
    return r.id;
  }
  async finishRun(id: string, input: { status: SegmentRunRecord['status']; customersEvaluated?: number; segmentsEvaluated?: number; ordersStitched?: number; stats?: Record<string, unknown>; error?: string | null }) {
    await db.update(customerSegmentRuns).set({
      status: input.status, finishedAt: new Date(), customersEvaluated: input.customersEvaluated ?? null, segmentsEvaluated: input.segmentsEvaluated ?? null,
      ordersStitched: input.ordersStitched ?? null, stats: input.stats ?? {}, error: input.error ?? null,
    }).where(eq(customerSegmentRuns.id, id));
  }
  async listRuns(limit: number) {
    const r = await db.select().from(customerSegmentRuns).orderBy(desc(customerSegmentRuns.startedAt)).limit(limit);
    return r.map(toRun);
  }
  async lastCompletedRunAt() {
    const [r] = await db.select({ at: customerSegmentRuns.finishedAt }).from(customerSegmentRuns)
      .where(eq(customerSegmentRuns.status, 'COMPLETE')).orderBy(desc(customerSegmentRuns.finishedAt)).limit(1);
    return r?.at ?? null;
  }
}
