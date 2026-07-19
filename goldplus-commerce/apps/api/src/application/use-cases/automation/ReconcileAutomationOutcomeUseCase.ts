import { IAutomationActionRepository } from '../../ports/IAutomationActionRepository';

export type ReconcileAutomationOutcomeResult =
  | { ok: true; actionExecutionId: string; resolution: 'SENT' | 'FAILED' }
  | { ok: false; code: 'EVIDENCE_REQUIRED' | 'NOT_OUTCOME_UNKNOWN' };

/** Resolve an ambiguous accepted-or-not provider outcome from operator evidence. */
export class ReconcileAutomationOutcomeUseCase {
  constructor(private readonly actions: IAutomationActionRepository) {}

  async execute(input: {
    actionExecutionId: string;
    resolution: 'SENT' | 'FAILED';
    actorId: string;
    reason: string;
    now?: Date;
  }): Promise<ReconcileAutomationOutcomeResult> {
    if (!input.reason.trim()) return { ok: false, code: 'EVIDENCE_REQUIRED' };
    const reconciled = await this.actions.reconcileUnknown({
      actionExecutionId: input.actionExecutionId,
      resolution: input.resolution,
      actorId: input.actorId,
      reason: input.reason.trim(),
      now: input.now ?? new Date(),
    });
    if (!reconciled) return { ok: false, code: 'NOT_OUTCOME_UNKNOWN' };
    return { ok: true, actionExecutionId: input.actionExecutionId, resolution: input.resolution };
  }
}
