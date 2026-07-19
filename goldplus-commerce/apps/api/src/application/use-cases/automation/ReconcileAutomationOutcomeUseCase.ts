import { IAutomationActionRepository } from '../../ports/IAutomationActionRepository';

export type ReconcileAutomationOutcomeResult =
  | { ok: true; actionExecutionId: string; resolution: 'SENT' | 'FAILED' }
  | { ok: false; code: 'ACTOR_REQUIRED' | 'REASON_REQUIRED' | 'EVIDENCE_REQUIRED' | 'NOT_OUTCOME_UNKNOWN' };

/** Resolve an ambiguous accepted-or-not provider outcome from operator evidence. */
export class ReconcileAutomationOutcomeUseCase {
  constructor(private readonly actions: IAutomationActionRepository) {}

  async execute(input: {
    actionExecutionId: string;
    resolution: 'SENT' | 'FAILED';
    actorId: string;
    reason: string;
    evidence: string;
    correlationId?: string;
    now?: Date;
  }): Promise<ReconcileAutomationOutcomeResult> {
    if (!input.actorId.trim()) return { ok: false, code: 'ACTOR_REQUIRED' };
    if (!input.reason.trim()) return { ok: false, code: 'REASON_REQUIRED' };
    if (!input.evidence.trim()) return { ok: false, code: 'EVIDENCE_REQUIRED' };
    const reconciled = await this.actions.reconcileUnknown({
      actionExecutionId: input.actionExecutionId,
      resolution: input.resolution,
      actorId: input.actorId,
      reason: input.reason.trim(),
      evidence: input.evidence.trim(),
      correlationId: input.correlationId,
      now: input.now ?? new Date(),
    });
    if (!reconciled) return { ok: false, code: 'NOT_OUTCOME_UNKNOWN' };
    return { ok: true, actionExecutionId: input.actionExecutionId, resolution: input.resolution };
  }
}
