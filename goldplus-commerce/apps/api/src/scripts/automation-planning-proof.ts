import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { users } from '../infrastructure/db/schema/identity';
import { customerProfiles } from '../infrastructure/db/schema/customer_dna';
import { automationDefinitions, automationVersions, automationExecutions, automationActionExecutions, automationEvents } from '../infrastructure/db/schema/automation';
import { DrizzleAutomationRepository, DrizzleAutomationExecutionRepository, DrizzleAutomationAudienceReader } from '../infrastructure/db/repositories/DrizzleAutomationRepositories';
import { PlanAutomationExecutionUseCase } from '../application/use-cases/automation/PlanAutomationExecutionUseCase';
import { eq, inArray, sql } from 'drizzle-orm';
import { encodeAutomationJsonb } from '../infrastructure/db/AutomationJsonbCodec';

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
  const versionConfig = {
    triggerFamily: 'DOMAIN_EVENT' as const,
    triggerRef: 'OrderPlaced',
    audiencePolicyMode: 'REEVALUATE_AT_EXECUTION' as const,
    conditions: [{ conditionId: 'c1', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' }],
    actions: [{ actionIndex: 0, family: 'INTERNAL_NOTIFICATION' as const, channel: null, config: {} }],
    schedule: null,
    frequency: null,
  };
  await db.insert(automationVersions).values({
    id: verId, definitionId: defId, versionNumber: 1, requiresApproval: false, createdBy: creator,
    config: encodeAutomationJsonb(versionConfig) as any,
  });
  const versionStorageResult: any = await db.execute(sql`
    SELECT jsonb_typeof(config) AS "storedType", config->>'triggerFamily' AS "triggerFamily"
    FROM automation_versions WHERE id = ${verId}
  `);
  const versionStorage = (versionStorageResult.rows ?? versionStorageResult)[0];

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
  const evidenceStorageResult: any = execRows[0] ? await db.execute(sql`
    SELECT jsonb_typeof(evidence) AS "storedType", evidence->'audience'->>'outcome' AS "audienceOutcome"
    FROM automation_executions WHERE id = ${execRows[0].id}
  `) : [];
  const evidenceStorage = (evidenceStorageResult.rows ?? evidenceStorageResult)[0];
  const plannedTotal = a.result.planned + b.result.planned;
  const dupTotal = a.result.duplicate + b.result.duplicate;

  // Repeat → duplicate, no new plan.
  const again = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId, subjectId: eligibleSubject, now });
  const execAfter = await db.select().from(automationExecutions).where(eq(automationExecutions.triggerExecutionKey, triggerKey));

  // Ineligible (lifecycle condition fails).
  const inelig = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: randomUUID(), subjectId: lapsedSubject, now });
  // No profile.
  const noProfile = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: randomUUID(), subjectId: randomUUID(), now });

  // Arrays use the same bounded writer and remain native PostgreSQL JSONB arrays.
  const arrayExecutionId = randomUUID();
  await db.insert(automationExecutions).values({
    id: arrayExecutionId, definitionId: defId, versionId: verId, versionNumber: 1,
    triggerExecutionKey: `automation:${defId}:v1:array-proof:${randomUUID()}`,
    triggerFamily: 'MANUAL_ADMIN', windowKey: '2026-07-19', status: 'INELIGIBLE',
    evidence: encodeAutomationJsonb([{ result: false, reason: 'ARRAY_PROOF' }]) as any,
  });
  const arrayStorageResult: any = await db.execute(sql`
    SELECT jsonb_typeof(evidence) AS "storedType" FROM automation_executions WHERE id = ${arrayExecutionId}
  `);
  const arrayStorage = (arrayStorageResult.rows ?? arrayStorageResult)[0];

  // One historical double-encoded layer remains readable with semantic equality.
  const legacyDefId = randomUUID();
  const legacyVerId = randomUUID();
  const legacyConfig = { ...versionConfig, triggerRef: 'A30_LEGACY_COMPAT' };
  await db.insert(automationDefinitions).values({ id: legacyDefId, name: 'A3.0 legacy compatibility', status: 'ACTIVE', currentVersion: 1 });
  await db.execute(sql`
    INSERT INTO automation_versions (id, definition_id, version_number, config, requires_approval)
    VALUES (${legacyVerId}, ${legacyDefId}, 1, to_jsonb(${JSON.stringify(legacyConfig)}::text), false)
  `);
  const legacyStorageResult: any = await db.execute(sql`
    SELECT jsonb_typeof(config) AS "storedType",
           ((config #>> '{}')::jsonb)->>'triggerRef' AS "oneLayerTriggerRef"
    FROM automation_versions WHERE id = ${legacyVerId}
  `);
  const legacyStorage = (legacyStorageResult.rows ?? legacyStorageResult)[0];
  const legacyRead = await new DrizzleAutomationRepository().findActiveApprovedByTrigger('DOMAIN_EVENT', 'A30_LEGACY_COMPAT', now);

  // Malformed one-layer data fails closed; it is never recursively parsed or treated as a match.
  const malformedDefId = randomUUID();
  const malformedVerId = randomUUID();
  await db.insert(automationDefinitions).values({ id: malformedDefId, name: 'A3.0 malformed compatibility', status: 'ACTIVE', currentVersion: 1 });
  await db.execute(sql`
    INSERT INTO automation_versions (id, definition_id, version_number, config, requires_approval)
    VALUES (${malformedVerId}, ${malformedDefId}, 1, to_jsonb(${`{"triggerFamily":`}::text), false)
  `);
  let malformedRejected = false;
  try {
    await new DrizzleAutomationRepository().findActiveApprovedByTrigger('DOMAIN_EVENT', 'A30_MALFORMED', now);
  } catch {
    malformedRejected = true;
  }

  const ok =
    versionStorage?.storedType === 'object' && versionStorage?.triggerFamily === 'DOMAIN_EVENT' &&
    execRows.length === 1 &&
    actionRows.length === 1 &&
    !!execRows[0].evidence &&
    evidenceStorage?.storedType === 'object' && evidenceStorage?.audienceOutcome === 'ELIGIBLE' &&
    arrayStorage?.storedType === 'array' &&
    legacyStorage?.storedType === 'string' && legacyStorage?.oneLayerTriggerRef === 'A30_LEGACY_COMPAT' &&
    legacyRead.length === 1 && legacyRead[0].config.triggerRef === legacyConfig.triggerRef &&
    malformedRejected &&
    plannedTotal === 1 && dupTotal === 1 &&
    again.result.duplicate === 1 && execAfter.length === 1 &&
    inelig.result.ineligible === 1 && inelig.result.planned === 0 &&
    noProfile.result.ineligible === 1 && noProfile.result.noData === 1;

  console.log(JSON.stringify({
    versionJsonbType: versionStorage?.storedType, versionSqlTrigger: versionStorage?.triggerFamily,
    executionRows: execRows.length, plannedActionRows: actionRows.length, evidencePresent: !!execRows[0]?.evidence,
    evidenceJsonbType: evidenceStorage?.storedType, evidenceSqlOutcome: evidenceStorage?.audienceOutcome,
    arrayJsonbType: arrayStorage?.storedType,
    legacyJsonbType: legacyStorage?.storedType, legacySemanticMatch: legacyRead[0]?.config.triggerRef === legacyConfig.triggerRef,
    malformedRejected,
    plannedTotal, duplicateTotal: dupTotal, repeatDuplicate: again.result.duplicate,
    ineligiblePlanned: inelig.result.planned, ineligibleCount: inelig.result.ineligible,
    noProfileNoData: noProfile.result.noData,
    providerCalls: 0,
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
  const definitionIds = [defId, legacyDefId, malformedDefId];
  await db.delete(automationEvents).where(inArray(automationEvents.definitionId, definitionIds));
  await db.delete(automationVersions).where(inArray(automationVersions.definitionId, definitionIds));
  await db.delete(automationDefinitions).where(inArray(automationDefinitions.id, definitionIds));
  await db.delete(customerProfiles).where(inArray(customerProfiles.canonicalCustomerId, [eligibleSubject, lapsedSubject]));
  await db.delete(users).where(eq(users.id, creator));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('AUTOMATION_A2_PROOF_ERROR', e?.message); process.exit(1); });
