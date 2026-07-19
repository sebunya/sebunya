import { FraudTriageRepositoryError, IFraudTriageRepository } from '../../ports/IFraudTriageRepository';
import { FRAUD_CASE_STATUSES, FraudCaseStatus, FraudDecision, FraudSignalInput, canReviewFraudCase, validateFraudEvidence, validateFraudSignal } from '../../../domain/fraud/FraudTriage';

export class FraudTriageOperationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export class FraudTriageOperationsUseCase {
  constructor(private readonly repo: IFraudTriageRepository) {}

  async recordSignal(input: FraudSignalInput & { actorId: string }) {
    const errors = validateFraudSignal(input);
    if (errors.length) throw new FraudTriageOperationError('INVALID_SIGNAL', errors[0]);
    try { return await this.repo.recordSignal(input, input.actorId); }
    catch (error) {
      if (error instanceof FraudTriageRepositoryError) throw new FraudTriageOperationError(error.code, error.message);
      throw error;
    }
  }
  list(filters?: { status?: FraudCaseStatus; assignedTo?: string }) {
    if (filters?.status && !FRAUD_CASE_STATUSES.includes(filters.status)) throw new FraudTriageOperationError('INVALID_STATUS', 'Unknown fraud case status.');
    return this.repo.list(filters);
  }
  async detail(id: string) {
    const fraudCase = await this.repo.find(id);
    if (!fraudCase) throw new FraudTriageOperationError('FRAUD_CASE_NOT_FOUND', 'Fraud case was not found.');
    return { fraudCase, signals: await this.repo.signals(id), events: await this.repo.events(id), safeguards: { reviewFirst: true, automaticDeclineEnabled: false, checkoutMutationEnabled: false } };
  }
  overview() { return this.repo.overview(); }
  async assign(input: { id: string; expectedVersion: number; assigneeId: string; actorId: string; reason: string }) {
    if (!input.reason.trim()) throw new FraudTriageOperationError('REASON_REQUIRED', 'Assignment reason is required.');
    const updated = await this.repo.assign({ ...input, reason: input.reason.trim() });
    if (!updated) throw new FraudTriageOperationError('STALE_VERSION', 'Fraud case changed after it was loaded.');
    return updated;
  }
  async decide(input: { id: string; expectedVersion: number; decision: FraudDecision; actorId: string; reason: string; evidence: Record<string, unknown> }) {
    const current = await this.repo.find(input.id);
    if (!current) throw new FraudTriageOperationError('FRAUD_CASE_NOT_FOUND', 'Fraud case was not found.');
    if (!canReviewFraudCase(current.status)) throw new FraudTriageOperationError('CASE_RESOLVED', 'Resolved cases are immutable.');
    if (!input.reason.trim()) throw new FraudTriageOperationError('REASON_REQUIRED', 'Decision reason is required.');
    if (Object.keys(input.evidence ?? {}).length === 0) throw new FraudTriageOperationError('EVIDENCE_REQUIRED', 'Decision evidence is required.');
    const evidenceErrors = validateFraudEvidence(input.evidence);
    if (evidenceErrors.length) throw new FraudTriageOperationError('INVALID_EVIDENCE', evidenceErrors[0]);
    const updated = await this.repo.decide({ ...input, reason: input.reason.trim() });
    if (!updated) throw new FraudTriageOperationError('STALE_VERSION', 'Fraud case changed after it was loaded.');
    return updated;
  }
}
