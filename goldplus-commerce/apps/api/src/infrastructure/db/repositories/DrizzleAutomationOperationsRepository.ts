import { and, desc, eq, sql } from 'drizzle-orm';
import {
  EXECUTION_STATUSES,
  ApprovalStatus,
  DefinitionStatus,
  canActivate,
  canTransitionDefinition,
} from '../../../domain/automation/Automation';
import {
  AutomationDefinitionDetail,
  AutomationDefinitionSummary,
  AutomationExecutionDetail,
  AutomationExecutionSummary,
  AutomationOperationError,
  AutomationOverview,
  AutomationVersionView,
  IAutomationOperationsRepository,
  OperationalAutomationVersion,
} from '../../../application/ports/IAutomationOperationsRepository';
import { db } from '../client';
import { decodeAutomationJsonb, decodeAutomationVersionConfig, encodeAutomationJsonb } from '../AutomationJsonbCodec';
import {
  automationActionExecutions,
  automationApprovals,
  automationDefinitions,
  automationEvents,
  automationExecutions,
  automationFrequencyCapReservations,
  automationSuppressions,
  automationVersions,
} from '../schema/automation';
import { outboxEvents } from '../schema/system';

const iso = (value: Date | null | undefined): string | null => value ? value.toISOString() : null;
const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];

function definitionSummary(row: any): AutomationDefinitionSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    status: row.status as DefinitionStatus,
    currentVersion: Number(row.currentVersion),
    approvalStatus: row.approvalStatus ?? null,
    approvalExpiresAt: iso(row.approvalExpiresAt),
    requiresApproval: row.requiresApproval ?? null,
    nextRunAt: iso(row.nextRunAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleAutomationOperationsRepository implements IAutomationOperationsRepository {
  async getOverview(now: Date): Promise<AutomationOverview> {
    const [definitionCounts, approvalCounts, executionCounts, actionCounts, suppressionCounts, timing, nextRun, provider] = await Promise.all([
      db.execute(sql`select
        count(*) filter (where status = 'ACTIVE')::int as active,
        count(*) filter (where status = 'PAUSED')::int as paused
        from automation_definitions`),
      db.execute(sql`select count(*)::int as pending from automation_approvals
        where status = 'PENDING' and (expires_at is null or expires_at > ${now})`),
      db.execute(sql`select status, count(*)::int as count from automation_executions group by status`),
      db.execute(sql`select status, count(*)::int as count from automation_action_executions group by status`),
      db.execute(sql`select reason, count(*)::int as count from automation_suppressions group by reason order by reason`),
      db.execute(sql`select
        extract(epoch from (${now} - (min(created_at) filter (where status = 'QUEUED'))))::float8 as oldest_queued,
        avg(extract(epoch from (updated_at - created_at)) * 1000) filter (where status in ('PLANNED','ELIGIBLE','INELIGIBLE'))::float8 as planning_ms,
        avg(extract(epoch from (updated_at - created_at)) * 1000) filter (where status in ('INTERNAL_SUCCESS','SENT','FAILED','OUTCOME_UNKNOWN','DEAD_LETTERED'))::float8 as execution_ms
        from automation_action_executions`),
      db.execute(sql`select min(next_run_at) as next_run from automation_definitions where status = 'ACTIVE' and next_run_at is not null`),
      db.execute(sql`select
        count(*) filter (where outbox_event_id is not null)::int as queued_intents,
        coalesce(sum(attempt_count) filter (where action_family in ('EMAIL','WHATSAPP_TEMPLATE')), 0)::int as attempted,
        count(*) filter (where action_family in ('EMAIL','WHATSAPP_TEMPLATE') and status = 'SENT')::int as succeeded,
        count(*) filter (where action_family in ('EMAIL','WHATSAPP_TEMPLATE') and status = 'OUTCOME_UNKNOWN')::int as ambiguous
        from automation_action_executions`),
    ]);
    const defs: any = rowsOf(definitionCounts)[0];
    const approvals: any = rowsOf(approvalCounts)[0];
    const times: any = rowsOf(timing)[0];
    const schedule: any = rowsOf(nextRun)[0];
    const readiness: any = rowsOf(provider)[0];
    const executions = Object.fromEntries(EXECUTION_STATUSES.map((status) => [status, 0])) as AutomationOverview['executions'];
    for (const row of rowsOf(executionCounts)) {
      if (row.status in executions) executions[row.status as keyof typeof executions] = Number(row.count);
    }
    for (const row of rowsOf(actionCounts)) {
      if (row.status in executions && !['PLANNED', 'ELIGIBLE', 'INELIGIBLE', 'DRY_RUN'].includes(row.status)) executions[row.status as keyof typeof executions] = Number(row.count);
    }
    return {
      activeAutomations: Number(defs?.active ?? 0),
      pausedAutomations: Number(defs?.paused ?? 0),
      pendingApprovals: Number(approvals?.pending ?? 0),
      executions,
      suppressionsByReason: Object.fromEntries(rowsOf(suppressionCounts).map((row) => [row.reason, Number(row.count)])),
      oldestQueuedAgeSeconds: times?.oldest_queued === null ? null : Number(times.oldest_queued),
      averagePlanningDurationMs: times?.planning_ms === null ? null : Number(times.planning_ms),
      averageExecutionDurationMs: times?.execution_ms === null ? null : Number(times.execution_ms),
      nextScheduledRun: iso(schedule?.next_run),
      providerReadiness: {
        queuedIntents: Number(readiness?.queued_intents ?? 0),
        attempted: Number(readiness?.attempted ?? 0),
        succeeded: Number(readiness?.succeeded ?? 0),
        ambiguous: Number(readiness?.ambiguous ?? 0),
      },
    };
  }

  async listDefinitions(input: { status?: string; limit: number; offset: number }) {
    const where = input.status ? sql`where d.status = ${input.status}` : sql``;
    const [rows, count] = await Promise.all([
      db.execute(sql`select d.id, d.name, d.description, d.status, d.current_version as "currentVersion",
        d.next_run_at as "nextRunAt", d.updated_at as "updatedAt", v.requires_approval as "requiresApproval",
        case when a.status='PENDING' and a.expires_at <= current_timestamp then 'EXPIRED' else a.status end as "approvalStatus", a.expires_at as "approvalExpiresAt"
        from automation_definitions d
        left join automation_versions v on v.definition_id=d.id and v.version_number=d.current_version
        left join lateral (select status, expires_at from automation_approvals where version_id=v.id order by created_at desc limit 1) a on true
        ${where} order by d.updated_at desc limit ${input.limit} offset ${input.offset}`),
      db.execute(sql`select count(*)::int as count from automation_definitions d ${where}`),
    ]);
    return { items: rowsOf(rows).map(definitionSummary), total: Number(rowsOf(count)[0]?.count ?? 0) };
  }

  async getDefinition(id: string): Promise<AutomationDefinitionDetail | null> {
    const listed = await db.execute(sql`select d.id, d.name, d.description, d.status, d.current_version as "currentVersion",
      d.next_run_at as "nextRunAt", d.updated_at as "updatedAt", v.requires_approval as "requiresApproval",
      case when a.status='PENDING' and a.expires_at <= current_timestamp then 'EXPIRED' else a.status end as "approvalStatus", a.expires_at as "approvalExpiresAt"
      from automation_definitions d
      left join automation_versions v on v.definition_id=d.id and v.version_number=d.current_version
      left join lateral (select status, expires_at from automation_approvals where version_id=v.id order by created_at desc limit 1) a on true
      where d.id=${id} limit 1`);
    const base: any = rowsOf(listed)[0];
    if (!base) return null;
    const [versions, events] = await Promise.all([
      db.execute(sql`select v.*, case when a.status='PENDING' and a.expires_at <= current_timestamp then 'EXPIRED' else a.status end as "approvalStatus", a.approver_id as "approverId", a.expires_at as "approvalExpiresAt", a.reason as "approvalReason"
        from automation_versions v
        left join lateral (select * from automation_approvals where version_id=v.id order by created_at desc limit 1) a on true
        where v.definition_id=${id} order by v.version_number desc`),
      db.select().from(automationEvents).where(eq(automationEvents.definitionId, id)).orderBy(desc(automationEvents.createdAt)).limit(200),
    ]);
    return {
      ...definitionSummary(base),
      versions: rowsOf(versions).map((row): AutomationVersionView => ({
        id: row.id,
        versionNumber: Number(row.version_number),
        config: decodeAutomationVersionConfig(row.config),
        requiresApproval: row.requires_approval,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        approval: row.approvalStatus ? { status: row.approvalStatus, approverId: row.approverId, expiresAt: iso(row.approvalExpiresAt), reason: row.approvalReason } : null,
      })),
      events: events.map((row) => ({ id: row.id, eventType: row.eventType, fromState: row.fromState, toState: row.toState, actorId: row.actorId, reason: row.reason, correlationId: row.correlationId, createdAt: row.createdAt.toISOString() })),
    };
  }

  async createDefinition(input: { name: string; description: string | null; actorId: string; now: Date }) {
    const [row] = await db.insert(automationDefinitions).values({
      name: input.name, description: input.description, status: 'DRAFT', currentVersion: 0,
      createdBy: input.actorId, createdAt: input.now, updatedAt: input.now,
    }).returning();
    await db.insert(automationEvents).values({ definitionId: row.id, eventType: 'DEFINITION_CREATED', actorId: input.actorId, toState: 'DRAFT', createdAt: input.now });
    return definitionSummary({ ...row, approvalStatus: null, approvalExpiresAt: null, requiresApproval: null });
  }

  async createVersion(input: { definitionId: string; expectedVersion: number; config: any; requiresApproval: boolean; actorId: string; now: Date }) {
    return db.transaction(async (tx) => {
      const [definition] = await tx.select().from(automationDefinitions).where(eq(automationDefinitions.id, input.definitionId)).limit(1).for('update');
      if (!definition) throw new AutomationOperationError('AUTOMATION_NOT_FOUND', 'Automation definition was not found.');
      if (definition.currentVersion !== input.expectedVersion) throw new AutomationOperationError('STALE_VERSION', 'The definition changed after it was loaded.');
      if (!['DRAFT', 'REJECTED'].includes(definition.status)) throw new AutomationOperationError('INVALID_TRANSITION', 'A new version requires a draft or rejected definition.');
      const next = definition.currentVersion + 1;
      const [version] = await tx.insert(automationVersions).values({
        definitionId: definition.id, versionNumber: next, config: encodeAutomationJsonb(input.config) as any,
        requiresApproval: input.requiresApproval, createdBy: input.actorId, createdAt: input.now,
      }).returning();
      await tx.update(automationDefinitions).set({ currentVersion: next, status: 'DRAFT', updatedAt: input.now }).where(eq(automationDefinitions.id, definition.id));
      await tx.insert(automationEvents).values({ definitionId: definition.id, versionId: version.id, eventType: 'VERSION_CREATED', actorId: input.actorId, fromState: definition.status, toState: 'DRAFT', createdAt: input.now });
      return { id: version.id, versionNumber: next, config: input.config, requiresApproval: input.requiresApproval, createdBy: input.actorId, createdAt: input.now.toISOString(), approval: null };
    });
  }

  async submit(input: { definitionId: string; expectedVersion: number; actorId: string; expiresAt: Date | null; now: Date }): Promise<void> {
    await db.transaction(async (tx) => {
      const [definition] = await tx.select().from(automationDefinitions).where(eq(automationDefinitions.id, input.definitionId)).limit(1).for('update');
      if (!definition) throw new AutomationOperationError('AUTOMATION_NOT_FOUND', 'Automation definition was not found.');
      if (definition.currentVersion !== input.expectedVersion) throw new AutomationOperationError('STALE_VERSION', 'The definition changed after it was loaded.');
      if (!canTransitionDefinition(definition.status as DefinitionStatus, 'READY_FOR_REVIEW')) throw new AutomationOperationError('INVALID_TRANSITION', 'Only a draft can be submitted.');
      const [version] = await tx.select().from(automationVersions).where(and(eq(automationVersions.definitionId, definition.id), eq(automationVersions.versionNumber, definition.currentVersion))).limit(1);
      if (!version) throw new AutomationOperationError('VERSION_NOT_FOUND', 'The current immutable version was not found.');
      await tx.insert(automationApprovals).values({ definitionId: definition.id, versionId: version.id, status: 'PENDING', expiresAt: input.expiresAt, createdAt: input.now });
      await tx.update(automationDefinitions).set({ status: 'READY_FOR_REVIEW', updatedAt: input.now }).where(eq(automationDefinitions.id, definition.id));
      await tx.insert(automationEvents).values({ definitionId: definition.id, versionId: version.id, eventType: 'SUBMITTED', actorId: input.actorId, fromState: definition.status, toState: 'READY_FOR_REVIEW', createdAt: input.now });
    });
  }

  async decide(input: { definitionId: string; versionId: string; expectedVersion: number; decision: 'APPROVED' | 'REJECTED'; actorId: string; reason: string | null; expiresAt: Date | null; now: Date }): Promise<void> {
    await db.transaction(async (tx) => {
      const [definition] = await tx.select().from(automationDefinitions).where(eq(automationDefinitions.id, input.definitionId)).limit(1).for('update');
      if (!definition) throw new AutomationOperationError('AUTOMATION_NOT_FOUND', 'Automation definition was not found.');
      if (definition.currentVersion !== input.expectedVersion) throw new AutomationOperationError('STALE_VERSION', 'The definition changed after it was loaded.');
      if (definition.status !== 'READY_FOR_REVIEW') throw new AutomationOperationError('INVALID_TRANSITION', 'The definition is not pending approval.');
      const [version] = await tx.select().from(automationVersions).where(and(eq(automationVersions.id, input.versionId), eq(automationVersions.definitionId, definition.id), eq(automationVersions.versionNumber, input.expectedVersion))).limit(1);
      if (!version) throw new AutomationOperationError('VERSION_NOT_FOUND', 'The submitted immutable version was not found.');
      const [approval] = await tx.select().from(automationApprovals).where(and(eq(automationApprovals.versionId, version.id), eq(automationApprovals.status, 'PENDING'))).orderBy(desc(automationApprovals.createdAt)).limit(1).for('update');
      if (!approval) throw new AutomationOperationError('INVALID_TRANSITION', 'No pending approval exists for this version.');
      if (approval.expiresAt && approval.expiresAt.getTime() <= input.now.getTime()) {
        throw new AutomationOperationError('APPROVAL_EXPIRED', 'The approval window has expired.');
      }
      await tx.update(automationApprovals).set({ status: input.decision, approverId: input.actorId, decidedAt: input.now, reason: input.reason, expiresAt: input.expiresAt ?? approval.expiresAt }).where(eq(automationApprovals.id, approval.id));
      const to = input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
      await tx.update(automationDefinitions).set({ status: to, updatedAt: input.now }).where(eq(automationDefinitions.id, definition.id));
      await tx.insert(automationEvents).values({ definitionId: definition.id, versionId: version.id, eventType: input.decision, actorId: input.actorId, fromState: definition.status, toState: to, reason: input.reason, createdAt: input.now });
    });
  }

  async transition(input: { definitionId: string; expectedVersion: number; to: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; actorId: string; reason: string | null; now: Date }): Promise<void> {
    await db.transaction(async (tx) => {
      const [definition] = await tx.select().from(automationDefinitions).where(eq(automationDefinitions.id, input.definitionId)).limit(1).for('update');
      if (!definition) throw new AutomationOperationError('AUTOMATION_NOT_FOUND', 'Automation definition was not found.');
      if (definition.currentVersion !== input.expectedVersion) throw new AutomationOperationError('STALE_VERSION', 'The definition changed after it was loaded.');
      if (!canTransitionDefinition(definition.status as DefinitionStatus, input.to)) throw new AutomationOperationError('INVALID_TRANSITION', `Cannot transition ${definition.status} to ${input.to}.`);
      if (input.to === 'ACTIVE') {
        const operational = await this.loadOperationalVersionInTransaction(tx, definition.id, input.now);
        if (!operational) throw new AutomationOperationError('VERSION_NOT_FOUND', 'The current immutable version was not found.');
        const [latestApproval] = await tx.select().from(automationApprovals).where(eq(automationApprovals.versionId, operational.versionId)).orderBy(desc(automationApprovals.createdAt)).limit(1);
        const approvalStatus: ApprovalStatus = latestApproval?.status === 'APPROVED' || latestApproval?.status === 'REJECTED' || latestApproval?.status === 'EXPIRED' || latestApproval?.status === 'PENDING'
          ? latestApproval.status
          : operational.requiresApproval ? 'PENDING' : 'NOT_REQUIRED';
        const activation = canActivate({ requiresApproval: operational.requiresApproval, approval: { status: approvalStatus, versionNumber: operational.versionNumber, expiresAt: latestApproval?.expiresAt ?? null }, now: input.now });
        if (!activation.ok) throw new AutomationOperationError(activation.code, activation.code === 'APPROVAL_EXPIRED' ? 'Approval has expired.' : 'Approval is required.');
      }
      await tx.update(automationDefinitions).set({ status: input.to, updatedAt: input.now }).where(eq(automationDefinitions.id, definition.id));
      await tx.insert(automationEvents).values({ definitionId: definition.id, eventType: input.to === 'ACTIVE' && definition.status === 'PAUSED' ? 'RESUMED' : input.to, actorId: input.actorId, fromState: definition.status, toState: input.to, reason: input.reason, createdAt: input.now });
    });
  }

  private async loadOperationalVersionInTransaction(tx: any, definitionId: string, now: Date): Promise<OperationalAutomationVersion | null> {
    const result = await tx.execute(sql`select d.id as definition_id, d.status as definition_status, v.id as version_id,
      v.version_number, v.requires_approval, v.config,
      exists(select 1 from automation_approvals a where a.version_id=v.id and a.status='APPROVED' and (a.expires_at is null or a.expires_at > ${now})) as approval_valid
      from automation_definitions d join automation_versions v on v.definition_id=d.id and v.version_number=d.current_version
      where d.id=${definitionId} limit 1`);
    const row: any = rowsOf(result)[0];
    return row ? { definitionId: row.definition_id, definitionStatus: row.definition_status, versionId: row.version_id, versionNumber: Number(row.version_number), requiresApproval: row.requires_approval, approvalValid: row.approval_valid, config: decodeAutomationVersionConfig(row.config) } : null;
  }

  async loadOperationalVersion(definitionId: string, now: Date): Promise<OperationalAutomationVersion | null> {
    return this.loadOperationalVersionInTransaction(db, definitionId, now);
  }

  async persistControlledExecution(input: { definition: OperationalAutomationVersion; triggerEventId: string; subjectId: string | null; windowKey: string; status: 'DRY_RUN' | 'ELIGIBLE' | 'INELIGIBLE'; evidence: unknown; actorId: string; now: Date }) {
    return db.transaction(async (tx) => {
      const triggerKey = `automation:${input.definition.definitionId}:v${input.definition.versionNumber}:manual:${input.triggerEventId}`;
      const inserted = await tx.insert(automationExecutions).values({
        definitionId: input.definition.definitionId, versionId: input.definition.versionId, versionNumber: input.definition.versionNumber,
        triggerExecutionKey: triggerKey, triggerFamily: 'MANUAL_ADMIN', triggerEventId: input.triggerEventId,
        subjectId: input.subjectId, windowKey: input.windowKey, status: input.status,
        plannedCount: input.status === 'ELIGIBLE' ? input.definition.config.actions.length : 0,
        ineligibleCount: input.status === 'INELIGIBLE' ? 1 : 0,
        evidence: encodeAutomationJsonb(input.evidence) as any, plannedAt: input.now, updatedAt: input.now,
      }).onConflictDoNothing({ target: automationExecutions.triggerExecutionKey }).returning({ id: automationExecutions.id });
      if (!inserted[0]) {
        const [existing] = await tx.select({ id: automationExecutions.id }).from(automationExecutions).where(eq(automationExecutions.triggerExecutionKey, triggerKey)).limit(1);
        return { executionId: existing.id, actionExecutionIds: [], duplicate: true };
      }
      const executionId = inserted[0].id;
      const actionExecutionIds: string[] = [];
      for (const action of input.definition.config.actions) {
        const [created] = await tx.insert(automationActionExecutions).values({
          executionId, actionIndex: action.actionIndex, actionFamily: action.family,
          idempotencyKey: `${triggerKey}:action:${action.actionIndex}`,
          status: input.status === 'DRY_RUN' ? 'DRY_RUN' : 'PLANNED', createdAt: input.now, updatedAt: input.now,
        }).returning({ id: automationActionExecutions.id });
        actionExecutionIds.push(created.id);
      }
      await tx.insert(automationEvents).values({ definitionId: input.definition.definitionId, versionId: input.definition.versionId, executionId, eventType: input.status === 'DRY_RUN' ? 'DRY_RUN' : 'MANUAL_EXECUTION', actorId: input.actorId, toState: input.status, correlationId: input.triggerEventId.slice(0, 64), createdAt: input.now });
      return { executionId, actionExecutionIds, duplicate: false };
    });
  }

  async listExecutions(input: { status?: string; definitionId?: string; limit: number; offset: number }) {
    const filters = [input.status ? sql`e.status=${input.status}` : null, input.definitionId ? sql`e.definition_id=${input.definitionId}` : null].filter(Boolean);
    const where = filters.length ? sql`where ${sql.join(filters as any, sql` and `)}` : sql``;
    const [rows, count] = await Promise.all([
      db.execute(sql`select e.id, e.definition_id, d.name as definition_name, e.version_id, e.version_number, e.trigger_family,
        e.subject_id, e.window_key, e.status, e.planned_at, e.updated_at from automation_executions e
        join automation_definitions d on d.id=e.definition_id ${where} order by e.planned_at desc limit ${input.limit} offset ${input.offset}`),
      db.execute(sql`select count(*)::int as count from automation_executions e ${where}`),
    ]);
    const items = rowsOf(rows).map((row): AutomationExecutionSummary => ({ id: row.id, definitionId: row.definition_id, definitionName: row.definition_name, versionId: row.version_id, versionNumber: Number(row.version_number), triggerFamily: row.trigger_family, subjectId: row.subject_id, windowKey: row.window_key, status: row.status, plannedAt: row.planned_at.toISOString(), updatedAt: row.updated_at.toISOString() }));
    return { items, total: Number(rowsOf(count)[0]?.count ?? 0) };
  }

  async getExecution(id: string): Promise<AutomationExecutionDetail | null> {
    const result = await db.execute(sql`select e.*, d.name as definition_name from automation_executions e join automation_definitions d on d.id=e.definition_id where e.id=${id} limit 1`);
    const row: any = rowsOf(result)[0];
    if (!row) return null;
    const [actions, suppressions, reservation, events] = await Promise.all([
      db.select({
        id: automationActionExecutions.id, actionIndex: automationActionExecutions.actionIndex, actionFamily: automationActionExecutions.actionFamily,
        status: automationActionExecutions.status, attemptCount: automationActionExecutions.attemptCount, nextRetryAt: automationActionExecutions.nextRetryAt,
        lastError: automationActionExecutions.lastError, outboxEventId: automationActionExecutions.outboxEventId,
        outboxStatus: outboxEvents.status, outboxProcessedAt: outboxEvents.processedAt,
        deadLetteredAt: automationActionExecutions.deadLetteredAt, replayedAt: automationActionExecutions.replayedAt,
        replayActor: automationActionExecutions.replayActor, sentAt: automationActionExecutions.sentAt,
      }).from(automationActionExecutions).leftJoin(outboxEvents, eq(outboxEvents.id, automationActionExecutions.outboxEventId)).where(eq(automationActionExecutions.executionId, id)).orderBy(automationActionExecutions.actionIndex),
      db.select({ reason: automationSuppressions.reason, createdAt: automationSuppressions.createdAt }).from(automationSuppressions).where(eq(automationSuppressions.executionId, id)).orderBy(automationSuppressions.createdAt),
      db.select().from(automationFrequencyCapReservations).where(eq(automationFrequencyCapReservations.executionId, id)).limit(1),
      db.select().from(automationEvents).where(eq(automationEvents.executionId, id)).orderBy(automationEvents.createdAt),
    ]);
    return {
      id: row.id, definitionId: row.definition_id, definitionName: row.definition_name, versionId: row.version_id,
      versionNumber: Number(row.version_number), triggerFamily: row.trigger_family, subjectId: row.subject_id, windowKey: row.window_key,
      status: row.status, plannedAt: row.planned_at.toISOString(), updatedAt: row.updated_at.toISOString(), evidence: decodeAutomationJsonb(row.evidence),
      actions: actions.map((action) => ({ ...action, nextRetryAt: iso(action.nextRetryAt), outboxProcessedAt: iso(action.outboxProcessedAt), deadLetteredAt: iso(action.deadLetteredAt), replayedAt: iso(action.replayedAt), sentAt: iso(action.sentAt) })),
      suppressions: suppressions.map((item) => ({ reason: item.reason, createdAt: item.createdAt.toISOString() })),
      frequencyReservation: reservation[0] ? { windowKey: reservation[0].windowKey, limitSnapshot: reservation[0].limitSnapshot, createdAt: reservation[0].createdAt.toISOString() } : null,
      events: events.map((event) => ({ id: event.id, eventType: event.eventType, fromState: event.fromState, toState: event.toState, actorId: event.actorId, reason: event.reason, correlationId: event.correlationId, createdAt: event.createdAt.toISOString() })),
    };
  }
}
