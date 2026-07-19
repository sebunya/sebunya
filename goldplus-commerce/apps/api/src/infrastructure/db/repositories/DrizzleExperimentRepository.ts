import { and, asc, eq, sql } from 'drizzle-orm';
import { IExperimentRepository, ExperimentRecord } from '../../../application/ports/IExperimentRepository';
import { ExperimentStatus, ExperimentVariant } from '../../../domain/experiments/Experiment';
import { db } from '../client';
import { experiments, experimentVariants, experimentAssignments, experimentExposures } from '../schema/experiments';

export class DrizzleExperimentRepository implements IExperimentRepository {
  private async hydrate(rows: typeof experiments.$inferSelect[]): Promise<ExperimentRecord[]> {
    if (!rows.length) return [];
    const variants = await db.select().from(experimentVariants).orderBy(asc(experimentVariants.createdAt));
    return rows.map((row) => ({ ...row, status: row.status as ExperimentStatus, variants: variants.filter((item) => item.experimentId === row.id).map((item) => ({ key: item.key, name: item.name, weightBasisPoints: item.weightBasisPoints })) }));
  }
  async create(input: { key: string; name: string; hypothesis: string; primaryMetric: string; variants: ExperimentVariant[]; actorId: string }) {
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(experiments).values({ key: input.key, name: input.name, hypothesis: input.hypothesis, primaryMetric: input.primaryMetric, createdBy: input.actorId }).returning();
      await tx.insert(experimentVariants).values(input.variants.map((variant) => ({ experimentId: row.id, ...variant })));
      return { ...row, status: row.status as ExperimentStatus, variants: input.variants };
    });
  }
  async list() { return this.hydrate(await db.select().from(experiments).orderBy(asc(experiments.createdAt))); }
  async find(id: string) { return (await this.hydrate(await db.select().from(experiments).where(eq(experiments.id, id)).limit(1)))[0] ?? null; }
  async transition(id: string, expectedVersion: number, from: ExperimentStatus, to: ExperimentStatus) {
    const [row] = await db.update(experiments).set({ status: to, version: sql`${experiments.version} + 1`, updatedAt: new Date() }).where(and(eq(experiments.id, id), eq(experiments.version, expectedVersion), eq(experiments.status, from))).returning();
    return row ? this.find(row.id) : null;
  }
  async assignAndExpose(input: { experiment: ExperimentRecord; subjectHash: string; variant: ExperimentVariant; exposureKey: string; occurredAt: Date }) {
    return db.transaction(async (tx) => {
      const inserted = await tx.insert(experimentAssignments).values({ experimentId: input.experiment.id, subjectHash: input.subjectHash, variantKey: input.variant.key, assignedAt: input.occurredAt }).onConflictDoNothing({ target: [experimentAssignments.experimentId, experimentAssignments.subjectHash] }).returning();
      const [assignment] = inserted.length ? inserted : await tx.select().from(experimentAssignments).where(and(eq(experimentAssignments.experimentId, input.experiment.id), eq(experimentAssignments.subjectHash, input.subjectHash))).limit(1);
      const [exposure] = await tx.insert(experimentExposures).values({ assignmentId: assignment.id, experimentId: input.experiment.id, exposureKey: input.exposureKey, occurredAt: input.occurredAt }).onConflictDoNothing({ target: [experimentExposures.experimentId, experimentExposures.exposureKey] }).returning();
      const storedExposure = exposure ?? (await tx.select().from(experimentExposures).where(and(eq(experimentExposures.experimentId, input.experiment.id), eq(experimentExposures.exposureKey, input.exposureKey))).limit(1))[0];
      return { assignment: { experimentId: input.experiment.id, variantKey: assignment.variantKey, subjectHash: assignment.subjectHash, assignedAt: assignment.assignedAt, exposureId: storedExposure.id, exposureKey: storedExposure.exposureKey }, duplicate: inserted.length === 0 || !exposure };
    });
  }
  async counts(id: string) {
    const [a] = await db.select({ count: sql<number>`count(*)::int` }).from(experimentAssignments).where(eq(experimentAssignments.experimentId, id));
    const [e] = await db.select({ count: sql<number>`count(*)::int` }).from(experimentExposures).where(eq(experimentExposures.experimentId, id));
    const grouped = await db.select({ key: experimentAssignments.variantKey, count: sql<number>`count(*)::int` }).from(experimentAssignments).where(eq(experimentAssignments.experimentId, id)).groupBy(experimentAssignments.variantKey);
    return { assignments: a?.count ?? 0, exposures: e?.count ?? 0, byVariant: Object.fromEntries(grouped.map((row) => [row.key, row.count])) };
  }
}
