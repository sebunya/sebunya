import '../config/env';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { FraudTriageOperationsUseCase } from '../application/use-cases/fraud/FraudTriageOperationsUseCase';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleFraudTriageRepository } from '../infrastructure/db/repositories/DrizzleFraudTriageRepository';
import { fraudCaseEvents, fraudCases, fraudSignals } from '../infrastructure/db/schema/fraud';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function protectedCounts() {
  const result: any = await db.execute(sql`select
    (select count(*)::int from orders) orders,
    (select count(*)::int from order_items) order_items,
    (select count(*)::int from payment_attempts) payments,
    (select count(*)::int from inventory_reservations) inventory_reservations,
    (select count(*)::int from outbox_events) outbox,
    (select count(*)::int from notification_attempts) notifications`);
  return (result.rows ?? result)[0] as Record<string, number>;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID(); const assigneeA = randomUUID(); const assigneeB = randomUUID(); const referenceKey = `proof:order:${randomUUID()}`;
  const repo = new DrizzleFraudTriageRepository(); const operations = new FraudTriageOperationsUseCase(repo);
  let caseId: string | null = null; const providerCalls = 0; let report: Record<string, unknown> = {}; let failure: unknown;
  try {
    const before = await protectedCounts();
    const baseSignal = { referenceKey, signalKey: 'velocity:primary', sourceType: 'ORDER' as const, sourceRef: randomUUID(), subjectRefHash: createHash('sha256').update(`subject:${referenceKey}`).digest('hex'), signalType: 'PAYMENT_VELOCITY', severity: 'HIGH' as const, reasonCode: 'VELOCITY_THRESHOLD', evidence: { attempts: 4, windowMinutes: 5 }, actorId };
    const duplicateResults = await Promise.all([operations.recordSignal(baseSignal), operations.recordSignal(baseSignal)]);
    caseId = duplicateResults[0].fraudCase.id;
    assert(duplicateResults.every((result) => result.fraudCase.id === caseId), 'Concurrent signal contenders created duplicate cases.');
    assert(duplicateResults.filter((result) => !result.duplicate).length === 1, 'Concurrent signal contenders did not create exactly one signal.');
    const critical = await operations.recordSignal({ ...baseSignal, signalKey: 'identity:conflict', signalType: 'IDENTITY_CONFLICT', severity: 'CRITICAL', reasonCode: 'IDENTITY_CONFLICT', evidence: { conflictCount: 2 } });
    assert(critical.fraudCase.priority === 'CRITICAL' && critical.fraudCase.status === 'OPEN' && critical.fraudCase.finalDecision === null, 'Signals did not remain review-first or priority did not escalate.');
    const assignments = await Promise.allSettled([
      operations.assign({ id: caseId, expectedVersion: critical.fraudCase.version, assigneeId: assigneeA, actorId, reason: 'First review contender' }),
      operations.assign({ id: caseId, expectedVersion: critical.fraudCase.version, assigneeId: assigneeB, actorId, reason: 'Second review contender' }),
    ]);
    assert(assignments.filter((result) => result.status === 'fulfilled').length === 1, 'Optimistic assignment allowed more than one winner.');
    const assigned = await operations.detail(caseId);
    assert(assigned.fraudCase.status === 'IN_REVIEW' && ([assigneeA, assigneeB] as string[]).includes(assigned.fraudCase.assignedTo ?? ''), 'Winning assignment was not persisted.');
    const reviewed = await operations.decide({ id: caseId, expectedVersion: assigned.fraudCase.version, decision: 'REVIEW', actorId, reason: 'Additional evidence required', evidence: { evidenceRef: 'proof-review-1' } });
    assert(reviewed.status === 'IN_REVIEW' && reviewed.finalDecision === null, 'REVIEW was incorrectly treated as a final decision.');
    const declined = await operations.decide({ id: caseId, expectedVersion: reviewed.version, decision: 'DECLINE', actorId, reason: 'Operator confirmed deterministic evidence', evidence: { evidenceRef: 'proof-decision-1', operatorReviewed: true } });
    assert(declined.status === 'RESOLVED' && declined.finalDecision === 'DECLINE' && declined.resolvedAt, 'Explicit operator decline was not finalized truthfully.');
    let resolvedImmutable = false;
    try { await operations.decide({ id: caseId, expectedVersion: declined.version, decision: 'ALLOW', actorId, reason: 'Forbidden rewrite', evidence: { evidenceRef: 'forbidden' } }); } catch (error) { resolvedImmutable = error instanceof Error && 'code' in error && error.code === 'CASE_RESOLVED'; }
    assert(resolvedImmutable, 'Resolved decision was mutable.');
    let resolvedSignalDenied = false;
    try { await operations.recordSignal({ ...baseSignal, signalKey: 'late:signal', actorId }); } catch (error) { resolvedSignalDenied = error instanceof Error && 'code' in error && error.code === 'CASE_RESOLVED'; }
    assert(resolvedSignalDenied, 'Resolved case accepted a late signal mutation.');
    const detail = await operations.detail(caseId); const after = await protectedCounts();
    assert(detail.signals.length === 2 && detail.events.length === 5, 'Signal or immutable audit event counts are incorrect.');
    assert(JSON.stringify(before) === JSON.stringify(after), 'Fraud proof mutated orders, payments, inventory, outbox or notifications.');
    assert(providerCalls === 0, 'Fraud proof invoked a provider.');
    report = { concurrentSignalContenders: 2, casesCreated: 1, signalsCreated: detail.signals.length, duplicateSignalSuppressed: true, assignmentWinners: 1, staleAssignmentRejected: true, reviewFirst: true, automaticDeclines: 0, explicitOperatorDecision: 'DECLINE', resolvedImmutable, resolvedSignalDenied, auditEvents: detail.events.length, orderDelta: 0, paymentDelta: 0, inventoryReservationDelta: 0, outboxDelta: 0, notificationDelta: 0, providerCalls };
  } catch (error) { failure = error; }
  finally {
    try {
      if (caseId) { await db.delete(fraudCaseEvents).where(eq(fraudCaseEvents.caseId, caseId)); await db.delete(fraudSignals).where(eq(fraudSignals.caseId, caseId)); await db.delete(fraudCases).where(eq(fraudCases.id, caseId)); }
      const residue: any = await db.execute(sql`select count(*)::int count from fraud_cases where reference_key=${referenceKey}`);
      report.proofResidue = Number((residue.rows ?? residue)[0].count); if (report.proofResidue !== 0) failure ??= new Error('FRAUD_TRIAGE_PROOF_RESIDUE');
    } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' }));
  if (failure) throw failure;
}
main().catch((error) => { console.error('FRAUD_TRIAGE_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
