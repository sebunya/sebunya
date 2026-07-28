import '../config/env';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import app from '../interfaces/http/app';
import { Hs256TokenSigner } from '../infrastructure/security/Hs256TokenSigner';
import { db, endDbConnection } from '../infrastructure/db/client';
import { QueueService } from '../infrastructure/queues/QueueService';
import { users, roles, permissions, rolePermissions, userRoles } from '../infrastructure/db/schema/identity';
import {
  automationActionExecutions,
  automationApprovals,
  automationDefinitions,
  automationEvents,
  automationExecutions,
  automationFrequencyCapReservations,
  automationSuppressions,
  automationVersions,
} from '../infrastructure/db/schema/automation';
import { auditLogs, outboxEvents } from '../infrastructure/db/schema/system';
import { encodeAutomationJsonb } from '../infrastructure/db/AutomationJsonbCodec';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID();
  const roleId = randomUUID();
  const permissionIds = Array.from({ length: 7 }, () => randomUUID());
  const definitionIds: string[] = [];
  const executionIds: string[] = [];
  const actionIds: string[] = [];
  const config = {
    triggerFamily: 'MANUAL_ADMIN', triggerRef: 'a4-proof', audiencePolicyMode: 'SNAPSHOT_AT_PLAN',
    conditions: [{ conditionId: 'consent', category: 'consent', operator: 'equals', expected: true }],
    actions: [{ actionIndex: 0, family: 'NO_ACTION', channel: null, config: {} }],
    schedule: null,
    frequency: { perCustomerPerWindow: 1, windowDays: 7, global: false, countsAttempts: false },
  };
  let final: Record<string, unknown> = { verdict: 'FAIL' };
  try {
    await db.insert(users).values({ id: actorId, email: `a4-${actorId}@fixture.local`, passwordHash: 'not-used', isActive: true });
    await db.insert(roles).values({ id: roleId, name: `a4-${roleId.slice(0, 8)}` });
    const codes = ['automation.read', 'automation.create', 'automation.manage', 'automation.approve', 'automation.execute', 'automation.replay', 'automation.reconcile'];
    await db.insert(permissions).values(codes.map((code, index) => ({ id: permissionIds[index], action: code.split('.')[0], resource: code.split('.')[1] })));
    await db.insert(rolePermissions).values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
    await db.insert(userRoles).values({ userId: actorId, roleId });

    const token = await new Hs256TokenSigner().sign({ subject: actorId, email: `a4-${actorId}@fixture.local`, ttlSeconds: 600 });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-correlation-id': 'a4-control-room-proof' };
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const response = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { response, body: await response.json().catch(() => null) as any };
    };

    const loggedOut = await app.request('/admin/automation/overview');
    assert(loggedOut.status === 401, 'overview must reject logged-out access');

    const created = await call('/admin/automation/definitions', 'POST', { name: 'A4 PostgreSQL proof', description: 'Scratch definition removed by proof cleanup.' });
    assert(created.response.status === 201 && created.body.success, 'draft creation API failed');
    const definitionId = created.body.data.id as string;
    definitionIds.push(definitionId);

    const version = await call(`/admin/automation/definitions/${definitionId}/versions`, 'POST', { expectedVersion: 0, config });
    assert(version.response.status === 201 && version.body.data.versionNumber === 1, 'immutable version creation failed');
    const versionId = version.body.data.id as string;

    const beforeConfig = await db.select({ config: automationVersions.config }).from(automationVersions).where(eq(automationVersions.id, versionId)).limit(1);
    const stale = await call(`/admin/automation/definitions/${definitionId}/versions`, 'POST', { expectedVersion: 0, config });
    assert(stale.response.status === 409 && stale.body.error.code === 'STALE_VERSION', 'stale version conflict was not precise');

    const submitted = await call(`/admin/automation/definitions/${definitionId}/submit`, 'POST', { expectedVersion: 1, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert(submitted.response.status === 200 && submitted.body.data.status === 'PENDING_APPROVAL', 'submission failed');
    const approved = await call(`/admin/automation/definitions/${definitionId}/approve`, 'POST', { versionId, expectedVersion: 1, reason: 'A4 proof approval', expiresAt: null });
    assert(approved.response.status === 200, 'approval failed');
    assert((await call(`/admin/automation/definitions/${definitionId}/activate`, 'POST', { expectedVersion: 1, reason: 'A4 proof activation' })).response.status === 200, 'activation failed');
    assert((await call(`/admin/automation/definitions/${definitionId}/pause`, 'POST', { expectedVersion: 1, reason: 'A4 proof pause' })).response.status === 200, 'pause failed');
    assert((await call(`/admin/automation/definitions/${definitionId}/resume`, 'POST', { expectedVersion: 1, reason: 'A4 proof resume' })).response.status === 200, 'resume failed');

    const dryRun = await call(`/admin/automation/definitions/${definitionId}/dry-run`, 'POST', { subjectId: null });
    assert(dryRun.response.status === 200 && dryRun.body.data.providerCalls === 0, 'dry run must persist with zero provider calls');
    executionIds.push(dryRun.body.data.executionId);
    const dryActionRows = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.executionId, dryRun.body.data.executionId));
    actionIds.push(...dryActionRows.map((row) => row.id));
    assert(dryActionRows.length === 1 && dryActionRows[0].status === 'DRY_RUN' && dryActionRows[0].attemptCount === 0, 'dry-run action state is not truthful');

    const unknownExecutionId = randomUUID();
    const unknownActionId = randomUUID();
    executionIds.push(unknownExecutionId); actionIds.push(unknownActionId);
    await db.insert(automationExecutions).values({
      id: unknownExecutionId, definitionId, versionId, versionNumber: 1,
      triggerExecutionKey: `a4:unknown:${unknownExecutionId}`, triggerFamily: 'MANUAL_ADMIN', triggerEventId: 'unknown-proof',
      subjectId: 'hashed-subject-proof', windowKey: '2026-07-19', status: 'OUTCOME_UNKNOWN', evidence: encodeAutomationJsonb({ audience: { outcome: 'NO_CONSENT' }, conditions: [] }) as any,
    });
    await db.insert(automationActionExecutions).values({ id: unknownActionId, executionId: unknownExecutionId, actionIndex: 0, actionFamily: 'EMAIL', idempotencyKey: `a4:unknown-action:${unknownActionId}`, status: 'OUTCOME_UNKNOWN', attemptCount: 1, lastError: 'AMBIGUOUS_PROVIDER_RESULT' });
    await db.insert(automationSuppressions).values({ executionId: unknownExecutionId, actionExecutionId: unknownActionId, subjectId: null, reason: 'NO_CONSENT' });
    await db.insert(automationEvents).values({ definitionId, versionId, executionId: unknownExecutionId, eventType: 'PROVIDER_OUTCOME_UNKNOWN', fromState: 'PROCESSING', toState: 'OUTCOME_UNKNOWN', correlationId: 'a4-ambiguous-proof' });

    const unknownDetail = await call(`/admin/automation/executions/${unknownExecutionId}`);
    assert(unknownDetail.response.status === 200 && unknownDetail.body.data.actions[0].attemptCount === 1, 'attempt lineage missing');
    assert(unknownDetail.body.data.suppressions[0].reason === 'NO_CONSENT', 'suppression evidence missing');
    const replayGuard = await call(`/admin/automation/executions/${unknownExecutionId}/replay`, 'POST', { actionExecutionId: unknownActionId, reason: 'must remain blocked while ambiguous' });
    assert(replayGuard.response.status === 409 && replayGuard.body.error.code === 'REPLAY_NOT_ALLOWED', 'unresolved OUTCOME_UNKNOWN replay was not denied');
    const missingEvidence = await call(`/admin/automation/executions/${unknownExecutionId}/reconcile`, 'POST', { actionExecutionId: unknownActionId, resolution: 'FAILED', reason: 'provider ledger reviewed', evidence: '' });
    assert(missingEvidence.response.status === 400 && missingEvidence.body.error.code === 'RECONCILIATION_EVIDENCE_REQUIRED', 'missing reconciliation evidence was not rejected');
    const reconciled = await call(`/admin/automation/executions/${unknownExecutionId}/reconcile`, 'POST', { actionExecutionId: unknownActionId, resolution: 'FAILED', reason: 'provider ledger reviewed', evidence: 'provider-case-a4-42' });
    assert(reconciled.response.status === 200, 'evidence-backed reconciliation failed');
    const [reconciledAction] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, unknownActionId)).limit(1);
    assert(reconciledAction.status === 'FAILED' && reconciledAction.attemptCount === 1, 'reconciliation did not preserve attempt lineage');

    const rejectedCreated = await call('/admin/automation/definitions', 'POST', { name: 'A4 rejection proof' });
    const rejectedDefinitionId = rejectedCreated.body.data.id as string;
    definitionIds.push(rejectedDefinitionId);
    const rejectedVersion = await call(`/admin/automation/definitions/${rejectedDefinitionId}/versions`, 'POST', { expectedVersion: 0, config });
    await call(`/admin/automation/definitions/${rejectedDefinitionId}/submit`, 'POST', { expectedVersion: 1, expiresAt: null });
    const rejected = await call(`/admin/automation/definitions/${rejectedDefinitionId}/reject`, 'POST', { versionId: rejectedVersion.body.data.id, expectedVersion: 1, reason: 'Evidence insufficient', expiresAt: null });
    assert(rejected.response.status === 200 && rejected.body.data.status === 'REJECTED', 'rejection failed');

    const [overview, definitions, detail, executions] = await Promise.all([
      call('/admin/automation/overview'), call('/admin/automation/definitions?limit=10'), call(`/admin/automation/definitions/${definitionId}`), call(`/admin/automation/executions?definitionId=${definitionId}&limit=10`),
    ]);
    assert(overview.body.success && overview.body.data.activeAutomations >= 1, 'overview aggregates failed');
    assert(definitions.body.success && definitions.body.data.items.length >= 2, 'definition list failed');
    assert(detail.body.success && detail.body.data.versions.length === 1, 'definition detail failed');
    assert(executions.body.success && executions.body.data.items.length >= 2, 'execution list failed');

    const afterConfig = await db.select({ config: automationVersions.config }).from(automationVersions).where(eq(automationVersions.id, versionId)).limit(1);
    assert(JSON.stringify(beforeConfig[0].config) === JSON.stringify(afterConfig[0].config), 'immutable version config changed');
    const auditRows = await db.select().from(auditLogs).where(inArray(auditLogs.entityId, [...definitionIds, ...executionIds, ...actionIds]));
    const reconciliationAudit = auditRows.find((row) => row.action === 'AUTOMATION_OUTCOME_RECONCILED');
    assert(auditRows.length >= 12 && reconciliationAudit, 'required audit trail missing');
    const reconciliationEvent = await db.select().from(automationEvents).where(and(eq(automationEvents.executionId, unknownExecutionId), eq(automationEvents.eventType, 'OUTCOME_RECONCILED'))).limit(1);
    assert(reconciliationEvent[0]?.correlationId === 'a4-control-room-proof', 'reconciliation correlation id missing');

    final = {
      loggedOutStatus: loggedOut.status,
      draftCreated: true,
      immutableVersion: true,
      staleConflict: stale.body.error.code,
      submitted: true,
      approved: true,
      rejected: true,
      activatedPausedResumed: true,
      dryRunProviderCalls: dryRun.body.data.providerCalls,
      dryRunStatus: dryActionRows[0].status,
      attemptHistory: unknownDetail.body.data.actions[0].attemptCount,
      suppressionEvidence: unknownDetail.body.data.suppressions[0].reason,
      replayGuard: replayGuard.body.error.code,
      reconciliationEvidenceRequired: missingEvidence.body.error.code,
      reconciledStatus: reconciledAction.status,
      reconciliationCorrelated: true,
      auditRows: auditRows.length,
      overviewActive: overview.body.data.activeAutomations,
      definitionRows: definitions.body.data.items.length,
      executionRows: executions.body.data.items.length,
      providerTransportCalls: 0,
      verdict: 'PASS',
    };
  } finally {
    if (definitionIds.length) {
      const relatedExecutions = await db.select({ id: automationExecutions.id }).from(automationExecutions).where(inArray(automationExecutions.definitionId, definitionIds));
      const allExecutionIds = Array.from(new Set([...executionIds, ...relatedExecutions.map((row) => row.id)]));
      const relatedActions = allExecutionIds.length ? await db.select({ id: automationActionExecutions.id, outboxEventId: automationActionExecutions.outboxEventId }).from(automationActionExecutions).where(inArray(automationActionExecutions.executionId, allExecutionIds)) : [];
      const allActionIds = Array.from(new Set([...actionIds, ...relatedActions.map((row) => row.id)]));
      const outboxIds = relatedActions.map((row) => row.outboxEventId).filter((value): value is string => !!value);
      if (allExecutionIds.length) {
        await db.delete(automationSuppressions).where(inArray(automationSuppressions.executionId, allExecutionIds));
        await db.delete(automationFrequencyCapReservations).where(inArray(automationFrequencyCapReservations.executionId, allExecutionIds));
        await db.delete(automationEvents).where(inArray(automationEvents.executionId, allExecutionIds));
      }
      if (allActionIds.length) await db.delete(auditLogs).where(inArray(auditLogs.entityId, allActionIds));
      if (allExecutionIds.length) {
        await db.delete(auditLogs).where(inArray(auditLogs.entityId, allExecutionIds));
        await db.delete(automationActionExecutions).where(inArray(automationActionExecutions.executionId, allExecutionIds));
        await db.delete(automationExecutions).where(inArray(automationExecutions.id, allExecutionIds));
      }
      if (outboxIds.length) await db.delete(outboxEvents).where(inArray(outboxEvents.id, outboxIds));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, definitionIds));
      await db.delete(automationEvents).where(inArray(automationEvents.definitionId, definitionIds));
      await db.delete(automationApprovals).where(inArray(automationApprovals.definitionId, definitionIds));
      await db.delete(automationVersions).where(inArray(automationVersions.definitionId, definitionIds));
      await db.delete(automationDefinitions).where(inArray(automationDefinitions.id, definitionIds));
    }
    await db.delete(userRoles).where(eq(userRoles.userId, actorId));
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    await db.delete(permissions).where(inArray(permissions.id, permissionIds));
    await db.delete(roles).where(eq(roles.id, roleId));
    await db.delete(users).where(eq(users.id, actorId));
    const residue = await db.execute(sql`select
      (select count(*) from automation_definitions where name like 'A4 % proof%')::int as definitions,
      (select count(*) from users where email like 'a4-%@fixture.local')::int as users`);
    const rows: any[] = (residue as any).rows ?? residue;
    final.proofResidue = Number(rows[0]?.definitions ?? 0) + Number(rows[0]?.users ?? 0);
    if (final.proofResidue !== 0) final.verdict = 'FAIL';
    await endDbConnection();
    // This proof drives the real Hono app, which opens queue/Redis connections.
    // Close them as the server does, otherwise the process never exits.
    await QueueService.getInstance().closeAll();
  }
  console.log(JSON.stringify(final));
  // Booting the real Hono app leaves a residual handle after every resource is closed,
  // so this proof would otherwise never exit and would hang an operator gate. The
  // verdict and all cleanup are complete at this point; exit deterministically once
  // stdout has drained.
  const code = final.verdict === 'PASS' ? 0 : 1;
  await new Promise<void>((resolve) => {
    if (process.stdout.writableLength === 0) resolve();
    else process.stdout.once('drain', () => resolve());
  });
  process.exit(code);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
