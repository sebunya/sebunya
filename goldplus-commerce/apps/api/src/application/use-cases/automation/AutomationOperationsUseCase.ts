import { randomUUID } from 'node:crypto';
import {
  AutomationVersionConfig,
  evaluateConditions,
  validateVersionConfig,
} from '../../../domain/automation/Automation';
import { IAutomationAudienceReader } from '../../ports/IAutomationRepository';
import {
  AutomationOperationError,
  IAutomationOperationsRepository,
  OperationalAutomationVersion,
} from '../../ports/IAutomationOperationsRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { ExecuteAutomationActionUseCase } from './ExecuteAutomationActionUseCase';
import { ReplayAutomationActionUseCase } from './ReplayAutomationActionUseCase';
import { ReconcileAutomationOutcomeUseCase } from './ReconcileAutomationOutcomeUseCase';

export type ControlledExecutionErrorCode = 'AUTOMATION_NOT_FOUND' | 'INVALID_TRANSITION' | 'NO_PROFILE' | 'NO_CONSENT' | 'IDENTITY_CONFLICT' | 'SUPPRESSED';

export class AutomationOperationsUseCase {
  constructor(
    private readonly operations: IAutomationOperationsRepository,
    private readonly audience: IAutomationAudienceReader,
    private readonly executeAction: ExecuteAutomationActionUseCase,
    private readonly replayAction: ReplayAutomationActionUseCase,
    private readonly reconcileOutcome: ReconcileAutomationOutcomeUseCase,
    private readonly audit: CreateAuditLogUseCase,
  ) {}

  overview(now = new Date()) { return this.operations.getOverview(now); }
  definitions(input: { status?: string; limit: number; offset: number }) { return this.operations.listDefinitions(input); }
  definition(id: string) { return this.operations.getDefinition(id); }
  executions(input: { status?: string; definitionId?: string; limit: number; offset: number }) { return this.operations.listExecutions(input); }
  execution(id: string) { return this.operations.getExecution(id); }

  private async record(actorId: string, action: string, entity: string, entityId: string, previousState: unknown, newState: unknown) {
    const result = await this.audit.execute({ actorId, action, entity, entityId, previousState, newState });
    if (!result.ok) throw new Error(`AUTOMATION_AUDIT_FAILED:${result.code}`);
  }

  async createDefinition(input: { name: string; description: string | null; actorId: string; now?: Date }) {
    const created = await this.operations.createDefinition({ ...input, now: input.now ?? new Date() });
    await this.record(input.actorId, 'AUTOMATION_DEFINITION_CREATED', 'automation_definition', created.id, null, { status: created.status, name: created.name });
    return created;
  }

  async createVersion(input: { definitionId: string; expectedVersion: number; config: AutomationVersionConfig; actorId: string; now?: Date }) {
    const validation = validateVersionConfig(input.config);
    if (!validation.ok) throw new AutomationOperationError('INVALID_TRANSITION', `Version configuration is invalid: ${validation.code}.`);
    const created = await this.operations.createVersion({ ...input, requiresApproval: validation.requiresApproval, now: input.now ?? new Date() });
    await this.record(input.actorId, 'AUTOMATION_VERSION_CREATED', 'automation_definition', input.definitionId, { expectedVersion: input.expectedVersion }, { versionId: created.id, versionNumber: created.versionNumber, requiresApproval: created.requiresApproval });
    await this.record(input.actorId, 'AUTOMATION_POLICY_CHANGED', 'automation_definition', input.definitionId, { version: input.expectedVersion }, { version: created.versionNumber, policy: 'immutable_version' });
    return created;
  }

  async submit(input: { definitionId: string; expectedVersion: number; expiresAt: Date | null; actorId: string; now?: Date }) {
    await this.operations.submit({ ...input, now: input.now ?? new Date() });
    await this.record(input.actorId, 'AUTOMATION_SUBMITTED', 'automation_definition', input.definitionId, { status: 'DRAFT' }, { status: 'READY_FOR_REVIEW', version: input.expectedVersion });
  }

  async decide(input: { definitionId: string; versionId: string; expectedVersion: number; decision: 'APPROVED' | 'REJECTED'; reason: string | null; expiresAt: Date | null; actorId: string; now?: Date }) {
    await this.operations.decide({ ...input, now: input.now ?? new Date() });
    await this.record(input.actorId, `AUTOMATION_${input.decision}`, 'automation_definition', input.definitionId, { status: 'READY_FOR_REVIEW', versionId: input.versionId }, { status: input.decision, reason: input.reason });
  }

  async transition(input: { definitionId: string; expectedVersion: number; to: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; reason: string | null; actorId: string; now?: Date }) {
    const before = await this.operations.getDefinition(input.definitionId);
    await this.operations.transition({ ...input, now: input.now ?? new Date() });
    const resumed = before?.status === 'PAUSED' && input.to === 'ACTIVE';
    await this.record(input.actorId, resumed ? 'AUTOMATION_RESUMED' : `AUTOMATION_${input.to}`, 'automation_definition', input.definitionId, { status: before?.status ?? null }, { status: input.to, reason: input.reason });
  }

  private async buildEvidence(definition: OperationalAutomationVersion, subjectId: string | null, now: Date) {
    if (!subjectId) return { audience: { outcome: 'NO_PROFILE', subjectId: null }, conditions: [], eligible: false };
    const audience = await this.audience.resolveSubject(subjectId, now);
    const conditions = evaluateConditions(definition.config.conditions, {
      lifecycleStage: audience.lifecycleStage,
      consentEligible: audience.consentEligible,
      identityConfidence: audience.identityConfidence,
      now,
    });
    return {
      audience,
      conditions: conditions.evidence,
      eligible: audience.outcome === 'ELIGIBLE' && audience.consentEligible === true && conditions.allPassed,
    };
  }

  async dryRun(input: { definitionId: string; subjectId: string | null; actorId: string; correlationId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const definition = await this.operations.loadOperationalVersion(input.definitionId, now);
    if (!definition) throw new AutomationOperationError('AUTOMATION_NOT_FOUND', 'Automation definition or current version was not found.');
    const evidence = await this.buildEvidence(definition, input.subjectId, now);
    const result = await this.operations.persistControlledExecution({ definition, triggerEventId: input.correlationId, subjectId: input.subjectId, windowKey: now.toISOString().slice(0, 10), status: 'DRY_RUN', evidence: { ...evidence, providerReadiness: { mode: 'DRY_RUN', providerCalls: 0 } }, actorId: input.actorId, now });
    await this.record(input.actorId, 'AUTOMATION_DRY_RUN', 'automation_execution', result.executionId, null, { definitionId: input.definitionId, correlationId: input.correlationId, providerCalls: 0, eligible: evidence.eligible });
    return { ...result, providerCalls: 0 as const, evidence };
  }

  async manualExecute(input: { definitionId: string; subjectId: string; actorId: string; correlationId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const definition = await this.operations.loadOperationalVersion(input.definitionId, now);
    if (!definition) throw new AutomationOperationError('AUTOMATION_NOT_FOUND', 'Automation definition or current version was not found.');
    if (definition.definitionStatus !== 'ACTIVE') throw new AutomationOperationError('INVALID_TRANSITION', 'Manual execution requires an active automation.');
    const evidence = await this.buildEvidence(definition, input.subjectId, now);
    const status = evidence.eligible ? 'ELIGIBLE' : 'INELIGIBLE';
    const persisted = await this.operations.persistControlledExecution({ definition, triggerEventId: input.correlationId, subjectId: input.subjectId, windowKey: now.toISOString().slice(0, 10), status, evidence, actorId: input.actorId, now });
    if (!evidence.eligible) {
      await this.record(input.actorId, 'AUTOMATION_MANUAL_EXECUTION', 'automation_execution', persisted.executionId, null, { status, correlationId: input.correlationId, providerCalls: 0, audience: (evidence.audience as any).outcome });
      return { ok: false as const, code: this.audienceCode((evidence.audience as any).outcome, (evidence.audience as any).consentEligible), executionId: persisted.executionId, providerCalls: 0 as const };
    }
    const outcomes = [];
    for (let index = 0; index < persisted.actionExecutionIds.length; index += 1) {
      const action = definition.config.actions[index];
      const actionExecutionId = persisted.actionExecutionIds[index];
      outcomes.push(await this.executeAction.execute({
        executionId: persisted.executionId, actionExecutionId, definitionId: definition.definitionId, versionId: definition.versionId,
        windowKey: now.toISOString().slice(0, 10), idempotencyKey: `automation:${definition.definitionId}:v${definition.versionNumber}:manual:${input.correlationId}:action:${action.actionIndex}`,
        frequency: definition.config.frequency, action, workerId: `admin:${input.actorId}`,
        definitionPaused: false, requiresApproval: definition.requiresApproval, approvalValid: definition.approvalValid,
        subjectId: input.subjectId, audienceOutcome: 'ELIGIBLE', consentEligible: true, conditionsPassed: true, now,
      }));
    }
    await this.record(input.actorId, 'AUTOMATION_MANUAL_EXECUTION', 'automation_execution', persisted.executionId, null, { status: 'ELIGIBLE', correlationId: input.correlationId, outcomes: outcomes.map((value) => value.outcome), providerCalls: 0 });
    return { ok: true as const, executionId: persisted.executionId, duplicate: persisted.duplicate, outcomes, providerCalls: 0 as const };
  }

  private audienceCode(outcome: string, consentEligible: boolean | null): ControlledExecutionErrorCode {
    if (outcome === 'NO_PROFILE') return 'NO_PROFILE';
    if (outcome === 'NO_CONSENT' || consentEligible !== true) return 'NO_CONSENT';
    if (outcome === 'IDENTITY_CONFLICT') return 'IDENTITY_CONFLICT';
    return 'SUPPRESSED';
  }

  async replay(input: { actionExecutionId: string; actorId: string; reason: string; correlationId?: string; now?: Date }) {
    const result = await this.replayAction.execute(input);
    if (!result.ok) throw new AutomationOperationError('REPLAY_NOT_ALLOWED', result.reason ?? result.code);
    await this.record(input.actorId, 'AUTOMATION_REPLAYED', 'automation_action_execution', input.actionExecutionId, null, { reason: input.reason, correlationId: input.correlationId ?? null, capReused: result.capReused });
    return result;
  }

  async reconcile(input: { actionExecutionId: string; resolution: 'SENT' | 'FAILED'; actorId: string; reason: string; evidence: string; correlationId: string; now?: Date }) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,255}$/.test(input.evidence.trim())) throw new AutomationOperationError('RECONCILIATION_EVIDENCE_REQUIRED', 'A bounded provider evidence reference is required; do not paste secrets or PII.');
    const result = await this.reconcileOutcome.execute(input);
    if (!result.ok) {
      if (result.code === 'EVIDENCE_REQUIRED') throw new AutomationOperationError('RECONCILIATION_EVIDENCE_REQUIRED', 'Independent reconciliation evidence is required.');
      if (result.code === 'NOT_OUTCOME_UNKNOWN') throw new AutomationOperationError('OUTCOME_NOT_AMBIGUOUS', 'Only OUTCOME_UNKNOWN can be reconciled.');
      throw new AutomationOperationError('RECONCILIATION_NOT_ALLOWED', result.code);
    }
    await this.record(input.actorId, 'AUTOMATION_OUTCOME_RECONCILED', 'automation_action_execution', input.actionExecutionId,
      { status: 'OUTCOME_UNKNOWN' },
      { status: input.resolution, reason: input.reason, evidence: input.evidence, correlationId: input.correlationId, reconciledAt: (input.now ?? new Date()).toISOString() });
    return result;
  }

  newCorrelationId() { return randomUUID(); }
}
