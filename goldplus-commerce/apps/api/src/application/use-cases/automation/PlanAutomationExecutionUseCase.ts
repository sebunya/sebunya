import {
  TriggerFamily, buildTriggerExecutionKey, buildActionIdempotencyKey, evaluateConditions,
} from '../../../domain/automation/Automation';
import { IAutomationRepository, IAutomationExecutionRepository, IAutomationAudienceReader } from '../../ports/IAutomationRepository';

export interface PlanBatchResult {
  matchedAutomations: number;
  planned: number;
  ineligible: number;
  noData: number;
  conflict: number;
  duplicate: number;
  limitExceeded: boolean;
}

const MAX_ACTIONS_PER_EXECUTION = 50;

/**
 * Restart-safe planning (A2). Loads active APPROVED immutable versions matching the
 * trigger, resolves the subject audience from real first-party data, evaluates
 * conditions into evidence, and persists ONE idempotent execution plan (unique
 * trigger_execution_key) with planned actions. It NEVER calls providers.
 */
export class PlanAutomationExecutionUseCase {
  constructor(
    private readonly automations: IAutomationRepository,
    private readonly executions: IAutomationExecutionRepository,
    private readonly audience: IAutomationAudienceReader
  ) {}

  async execute(input: {
    triggerFamily: TriggerFamily;
    triggerRef: string | null;
    triggerEventId: string;
    subjectId: string | null;
    windowKey?: string;
    now?: Date;
  }): Promise<{ ok: true; result: PlanBatchResult }> {
    const now = input.now ?? new Date();
    const windowKey = input.windowKey ?? now.toISOString().slice(0, 10);
    const result: PlanBatchResult = { matchedAutomations: 0, planned: 0, ineligible: 0, noData: 0, conflict: 0, duplicate: 0, limitExceeded: false };

    const active = await this.automations.findActiveApprovedByTrigger(input.triggerFamily, input.triggerRef, now);
    result.matchedAutomations = active.length;

    for (const a of active) {
      if (a.config.actions.length > MAX_ACTIONS_PER_EXECUTION) { result.limitExceeded = true; continue; }
      const triggerKey = buildTriggerExecutionKey(a.definitionId, a.versionNumber, input.triggerEventId);

      // Idempotent short-circuit: a duplicate trigger does not re-plan.
      const existing = await this.executions.findByTriggerKey(triggerKey);
      if (existing) { result.duplicate += 1; continue; }

      const subjectId = input.subjectId;
      let status: 'ELIGIBLE' | 'INELIGIBLE' = 'INELIGIBLE';
      let evidence: unknown = {};
      let plannedActions: { actionIndex: number; actionFamily: string; idempotencyKey: string }[] = [];

      if (!subjectId) {
        evidence = { audience: { outcome: 'NO_DATA' } };
        result.noData += 1;
      } else {
        const aud = await this.audience.resolveSubject(subjectId, now);
        if (aud.outcome === 'IDENTITY_CONFLICT') result.conflict += 1;
        if (aud.outcome === 'NO_PROFILE' || aud.outcome === 'NO_DATA') result.noData += 1;

        const cond = evaluateConditions(a.config.conditions, {
          lifecycleStage: aud.lifecycleStage, consentEligible: aud.consentEligible, identityConfidence: aud.identityConfidence, now,
        });
        const eligible = aud.outcome === 'ELIGIBLE' && cond.allPassed;
        evidence = { audience: aud, conditions: cond.evidence };
        if (eligible) {
          status = 'ELIGIBLE';
          plannedActions = a.config.actions.filter((act) => act.family !== 'NO_ACTION').map((act) => ({
            actionIndex: act.actionIndex, actionFamily: act.family,
            idempotencyKey: buildActionIdempotencyKey(a.definitionId, a.versionNumber, subjectId, windowKey, act.actionIndex),
          }));
        }
      }

      const persisted = await this.executions.persistPlan({
        definitionId: a.definitionId, versionId: a.versionId, versionNumber: a.versionNumber,
        triggerExecutionKey: triggerKey, triggerFamily: input.triggerFamily, triggerEventId: input.triggerEventId,
        subjectId, windowKey, status, evidence, plannedActions, expiresAt: null,
      });
      if (!persisted.created) { result.duplicate += 1; continue; }
      if (status === 'ELIGIBLE') result.planned += 1; else result.ineligible += 1;
    }

    return { ok: true, result };
  }
}
