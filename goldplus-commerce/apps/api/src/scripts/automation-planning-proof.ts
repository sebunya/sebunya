import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { users } from '../infrastructure/db/schema/identity';
import { customerProfiles } from '../infrastructure/db/schema/customer_dna';
import { automationDefinitions, automationVersions, automationExecutions, automationActionExecutions, automationEvents } from '../infrastructure/db/schema/automation';
import { DrizzleAutomationRepository, DrizzleAutomationExecutionRepository, DrizzleAutomationAudienceReader } from '../infrastructure/db/repositories/DrizzleAutomationRepositories';
import { PlanAutomationExecutionUseCase } from '../application/use-cases/automation/PlanAutomationExecutionUseCase';
import { eq, inArray } from 'drizzle-orm';

/**
 * Real-PostgreSQL proof (Automation A2): two planners race the same trigger and
 * exactly one execution plan + one planned-action set + one evidence set persist;
 * repeated ingestion does not duplicate; ineligible and no-profile subjects are
 * truthfully planned as INELIGIBLE. Refuses to run in production. No provider calls.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const now = new Date();

  const creator = randomUUID();
  await db.insert(users).values({ id: creator, email: `auto-${creator.slice(0, 8)}@ex.test`, phone: `072${creator.slice(0, 7)}`, passwordHash: 'x', isActive: true });

  const defId = randomUUID();
  await db.insert(automationDefinitions).values({ id: defId, name: 'AP Test', status: 'ACTIVE', currentVersion: 1, createdBy: creator });
  const verId = randomUUID();
  await db.insert(automationVersions).values({
    id: verId, definitionId: defId, versionNumber: 1, requiresApproval: false, createdBy: creator,
    config: { triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', audiencePolicyMode: 'REEVALUATE_AT_EXECUTION', conditions: [{ conditionId: 'c1', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' }], actions: [{ actionIndex: 0, family: 'INTERNAL_NOTIFICATION', channel: null, config: {} }], schedule: null, frequency: null },
  });

  const eligibleSubject = randomUUID();
  const lapsedSubject = randomUUID();
  await db.insert(customerProfiles).values([
    { canonicalCustomerId: eligibleSubject, primaryLifecycleStage: 'ACTIVE', identityConfidence: 'HIGH', consentEligible: true, computedAt: now },
    { canonicalCustomerId: lapsedSubject, primaryLifecycleStage: 'LAPSED', identityConfidence: 'HIGH', consentEligible: true, computedAt: now },
  ]);

  const uc = new PlanAutomationExecutionUseCase(new DrizzleAutomationRepository(), new DrizzleAutomationExecutionRepository(), new DrizzleAutomationAudienceReader());
  const triggerEventId = randomUUID();

  // Concurrent planners, same trigger event.
  const [a, b] = await Promise.all([
    uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId, subjectId: eligibleSubject, now }),
    uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId, subjectId: eligibleSubject, now }),
  ]);
  const triggerKey = `automation:${defId}:v1:trigger:${triggerEventId}`;
  const execRows = await db.select().from(automationExecutions).where(eq(automationExecutions.triggerExecutionKey, triggerKey));
  const actionRows = execRows[0] ? await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.executionId, execRows[0].id)) : [];
  const plannedTotal = a.result.planned + b.result.planned;
  const dupTotal = a.result.duplicate + b.result.duplicate;

  // Repeat → duplicate, no new plan.
  const again = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId, subjectId: eligibleSubject, now });
  const execAfter = await db.select().from(automationExecutions).where(eq(automationExecutions.triggerExecutionKey, triggerKey));

  // Ineligible (lifecycle condition fails).
  const inelig = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: randomUUID(), subjectId: lapsedSubject, now });
  // No profile.
  const noProfile = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: randomUUID(), subjectId: randomUUID(), now });

  const ok =
    execRows.length === 1 &&
    actionRows.length === 1 &&
    !!execRows[0].evidence &&
    plannedTotal === 1 && dupTotal === 1 &&
    again.result.duplicate === 1 && execAfter.length === 1 &&
    inelig.result.ineligible === 1 && inelig.result.planned === 0 &&
    noProfile.result.ineligible === 1 && noProfile.result.noData === 1;

  console.log(JSON.stringify({
    executionRows: execRows.length, plannedActionRows: actionRows.length, evidencePresent: !!execRows[0]?.evidence,
    plannedTotal, duplicateTotal: dupTotal, repeatDuplicate: again.result.duplicate,
    ineligiblePlanned: inelig.result.planned, ineligibleCount: inelig.result.ineligible,
    noProfileNoData: noProfile.result.noData,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  // Cleanup.
  const allExec = await db.select({ id: automationExecutions.id }).from(automationExecutions).where(eq(automationExecutions.definitionId, defId));
  const execIds = allExec.map((r) => r.id);
  if (execIds.length) {
    await db.delete(automationActionExecutions).where(inArray(automationActionExecutions.executionId, execIds));
    await db.delete(automationEvents).where(inArray(automationEvents.executionId, execIds));
    await db.delete(automationExecutions).where(inArray(automationExecutions.id, execIds));
  }
  await db.delete(automationEvents).where(eq(automationEvents.definitionId, defId));
  await db.delete(automationVersions).where(eq(automationVersions.definitionId, defId));
  await db.delete(automationDefinitions).where(eq(automationDefinitions.id, defId));
  await db.delete(customerProfiles).where(inArray(customerProfiles.canonicalCustomerId, [eligibleSubject, lapsedSubject]));
  await db.delete(users).where(eq(users.id, creator));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('AUTOMATION_A2_PROOF_ERROR', e?.message); process.exit(1); });
