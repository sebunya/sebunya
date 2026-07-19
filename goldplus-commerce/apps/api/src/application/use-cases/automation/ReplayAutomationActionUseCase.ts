import { evaluateConditions, isReplayable } from '../../../domain/automation/Automation';
import { IAutomationActionRepository } from '../../ports/IAutomationActionRepository';
import { IAutomationAudienceReader } from '../../ports/IAutomationRepository';
import { IOutboxRepository } from '../../ports/IOutboxRepository';
import { EvaluateExecutionEligibilityUseCase } from './EvaluateExecutionEligibilityUseCase';

export type ReplayAutomationActionResult =
  | { ok: true; actionExecutionId: string; capReused: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_REPLAYABLE' | 'NO_OUTBOX' | 'SUPPRESSED' | 'REPLAY_RACE'; reason?: string };

/** Gate-revalidated manual replay using the original outbox intent and cap slot. */
export class ReplayAutomationActionUseCase {
  constructor(
    private readonly actions: IAutomationActionRepository,
    private readonly outbox: IOutboxRepository,
    private readonly audience: IAutomationAudienceReader,
    private readonly eligibility: EvaluateExecutionEligibilityUseCase
  ) {}

  async execute(input: {
    actionExecutionId: string;
    actorId: string;
    reason: string;
    now?: Date;
  }): Promise<ReplayAutomationActionResult> {
    const now = input.now ?? new Date();
    const candidate = await this.actions.findReplayCandidate(input.actionExecutionId, now);
    if (!candidate) return { ok: false, code: 'NOT_FOUND' };
    if (!isReplayable(candidate.status)) return { ok: false, code: 'NOT_REPLAYABLE' };
    if (!candidate.outboxEventId) return { ok: false, code: 'NO_OUTBOX' };

    const audience = candidate.subjectId
      ? await this.audience.resolveSubject(candidate.subjectId, now)
      : null;
    const conditions = evaluateConditions(candidate.config.conditions, {
      lifecycleStage: audience?.lifecycleStage ?? null,
      consentEligible: audience?.consentEligible ?? null,
      identityConfidence: audience?.identityConfidence ?? null,
      now,
    });
    const gate = await this.eligibility.execute({
      executionId: candidate.executionId,
      definitionId: candidate.definitionId,
      versionId: candidate.versionId,
      windowKey: candidate.windowKey,
      frequency: candidate.config.frequency,
      mode: 'LIVE',
      modeSuppressionReason: null,
      definitionPaused: candidate.definitionPaused,
      requiresApproval: candidate.requiresApproval,
      approvalValid: candidate.approvalValid,
      subjectId: candidate.subjectId,
      audienceOutcome: audience?.outcome ?? null,
      consentEligible: audience?.consentEligible ?? null,
      conditionsPassed: conditions.allPassed,
    });
    if (!gate.eligible) {
      await this.actions.markTerminal(candidate.actionExecutionId, 'SUPPRESSED');
      return { ok: false, code: 'SUPPRESSED', reason: gate.suppressionReason };
    }

    const requeued = await this.outbox.requeueForReplay(candidate.outboxEventId, now);
    if (!requeued) return { ok: false, code: 'REPLAY_RACE' };
    const marked = await this.actions.markReplayed(candidate.actionExecutionId, input.actorId, input.reason, now);
    if (!marked) return { ok: false, code: 'REPLAY_RACE' };
    return { ok: true, actionExecutionId: candidate.actionExecutionId, capReused: gate.capReused };
  }
}
