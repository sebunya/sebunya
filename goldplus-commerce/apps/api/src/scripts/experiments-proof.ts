import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { ExperimentOperationsUseCase } from '../application/use-cases/experiments/ExperimentOperationsUseCase';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { DrizzleExperimentRepository } from '../infrastructure/db/repositories/DrizzleExperimentRepository';
import { experiments, experimentVariants, experimentAssignments, experimentExposures } from '../infrastructure/db/schema/experiments';
import { auditLogs } from '../infrastructure/db/schema/system';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID(); const ids: string[] = []; let report: Record<string, unknown> = {}; let failure: unknown;
  try {
    const useCase = new ExperimentOperationsUseCase(new DrizzleExperimentRepository(), new CreateAuditLogUseCase(new DrizzleAuditRepository()));
    const created = await useCase.create({ key: `proof-${randomUUID()}`, name: 'Experiment proof', hypothesis: 'Treatment changes the declared metric.', primaryMetric: 'completed_checkout_rate', variants: [{ key: 'control', name: 'Control', weightBasisPoints: 5000 }, { key: 'treatment', name: 'Treatment', weightBasisPoints: 5000 }], actorId });
    ids.push(created.id);
    const ready = await useCase.transition({ id: created.id, expectedVersion: 1, to: 'READY', actorId, reason: 'readiness evidence complete' });
    const running = await useCase.transition({ id: created.id, expectedVersion: ready.version, to: 'RUNNING', actorId, reason: 'controlled proof start' });
    const exposureKey = `exposure:${randomUUID()}`;
    const racers = await Promise.all([useCase.assignAndExpose({ id: created.id, subjectKey: 'customer-proof-key', exposureKey }), useCase.assignAndExpose({ id: created.id, subjectKey: 'customer-proof-key', exposureKey })]);
    assert(racers[0].assignment.variantKey === racers[1].assignment.variantKey, 'assignment was not stable');
    const assignmentRows = await db.select().from(experimentAssignments).where(eq(experimentAssignments.experimentId, created.id));
    const exposureRows = await db.select().from(experimentExposures).where(eq(experimentExposures.experimentId, created.id));
    assert(assignmentRows.length === 1 && exposureRows.length === 1, 'assignment/exposure idempotency failed');
    assert(assignmentRows[0].subjectHash.length === 64 && assignmentRows[0].subjectHash !== 'customer-proof-key', 'subject was not hashed');
    const paused = await useCase.transition({ id: created.id, expectedVersion: running.version, to: 'PAUSED', actorId, reason: 'pause proof' });
    let pausedDenied = false; try { await useCase.assignAndExpose({ id: created.id, subjectKey: 'second', exposureKey: `exposure:${randomUUID()}` }); } catch { pausedDenied = true; }
    const detail = await useCase.detail(created.id); const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id));
    const orphan: any = await db.execute(sql`select count(*)::int as count from experiment_exposures x left join experiment_assignments a on a.id=x.assignment_id where a.id is null`);
    assert(pausedDenied && detail.evidence.assignments === 1 && detail.evidence.exposures === 1 && detail.significance.status === 'NOT_CALCULATED', 'truthful evidence/guard failed');
    assert(audits.length === 4 && Number((orphan.rows ?? orphan)[0].count) === 0, 'audit/orphan proof failed');
    report = { lifecycle: `${created.status}->${ready.status}->${running.status}->${paused.status}`, stableVariant: racers[0].assignment.variantKey, assignmentRows: 1, exposureRows: 1, duplicateObserved: racers.some((item) => item.duplicate), hashedSubject: true, pausedAssignmentDenied: pausedDenied, significance: detail.significance.status, auditRows: audits.length, orphanExposures: 0 };
  } catch (error) { failure = error; }
  finally {
    try { if (ids.length) { const assignments = await db.select({ id: experimentAssignments.id }).from(experimentAssignments).where(inArray(experimentAssignments.experimentId, ids)); if (assignments.length) await db.delete(experimentExposures).where(inArray(experimentExposures.assignmentId, assignments.map((row) => row.id))); await db.delete(experimentAssignments).where(inArray(experimentAssignments.experimentId, ids)); await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids)); await db.delete(experimentVariants).where(inArray(experimentVariants.experimentId, ids)); await db.delete(experiments).where(inArray(experiments.id, ids)); } const residue: any = await db.execute(sql`select count(*)::int as count from experiments where name='Experiment proof'`); report.proofResidue = Number((residue.rows ?? residue)[0].count); if (report.proofResidue !== 0) failure ??= new Error('EXPERIMENT_PROOF_RESIDUE'); } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' })); if (failure) throw failure;
}
main().catch((error) => { console.error('EXPERIMENT_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
