import { ISurveyRepository } from '../../ports/ISurveyRepository';
import { SurveyAudience, SurveyQuestion, SurveyStatus, surveyParticipantHash, surveyVersionDigest, validateSurveyAnswers, validateSurveyQuestions } from '../../../domain/surveys/Survey';

export class SurveyOperationError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

export class SurveyOperationsUseCase {
  constructor(private readonly repo: ISurveyRepository) {}
  async create(input: { key: string; title: string; description: string; purposeKey: string; questions: SurveyQuestion[]; audience: SurveyAudience; actorId: string }) {
    if (!/^[a-z][a-z0-9_-]{2,79}$/.test(input.key)) throw new SurveyOperationError('INVALID_SURVEY', 'Survey key must be a bounded identifier.');
    if (input.title.trim().length < 3 || input.title.length > 160 || input.description.length > 1000) throw new SurveyOperationError('INVALID_SURVEY', 'Survey title or description is invalid.');
    if (input.purposeKey !== 'personalization') throw new SurveyOperationError('UNSUPPORTED_PURPOSE', 'Only the existing personalization consent purpose is supported.');
    if (input.audience.lifecycleStages.length > 10 || input.audience.lifecycleStages.some((stage) => !/^[A-Z_]{2,30}$/.test(stage))) throw new SurveyOperationError('INVALID_AUDIENCE', 'Audience lifecycle stages are invalid.');
    const errors = validateSurveyQuestions(input.questions); if (errors.length) throw new SurveyOperationError('INVALID_QUESTIONS', errors[0]);
    const normalized = { ...input, title: input.title.trim(), description: input.description.trim(), audience: { lifecycleStages: [...new Set(input.audience.lifecycleStages)].sort() } };
    return this.repo.create({ ...normalized, contentDigest: surveyVersionDigest(normalized) });
  }
  list() { return this.repo.list(); }
  async detail(id: string) { const found = await this.repo.detail(id); if (!found) throw new SurveyOperationError('SURVEY_NOT_FOUND', 'Survey was not found.'); return found; }
  private async transition(input: { id: string; expectedVersion: number; actorId: string; reason: string; from: SurveyStatus[]; to: SurveyStatus; different?: boolean }) {
    if (input.reason.trim().length < 3 || input.reason.length > 1000) throw new SurveyOperationError('REASON_REQUIRED', 'A bounded reason is required.');
    const result = await this.repo.transition({ ...input, reason: input.reason.trim(), requireDifferentActor: input.different });
    if (!result) throw new SurveyOperationError('STALE_VERSION', 'Survey changed, has an invalid state, or violates four-eyes approval.');
    return result;
  }
  submit(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['DRAFT'], to: 'PENDING_APPROVAL' }); }
  approve(input: { id: string; expectedVersion: number; actorId: string; reason: string; decision: 'APPROVED' | 'REJECTED' }) { return this.transition({ ...input, from: ['PENDING_APPROVAL'], to: input.decision, different: true }); }
  activate(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['APPROVED', 'PAUSED'], to: 'ACTIVE' }); }
  pause(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['ACTIVE'], to: 'PAUSED' }); }
  close(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['ACTIVE', 'PAUSED'], to: 'CLOSED' }); }
  eligible(userId: string) { return this.repo.eligible(userId); }
  async start(definitionId: string, userId: string) {
    const eligible = (await this.repo.eligible(userId)).find((item) => item.definition.id === definitionId);
    if (!eligible) throw new SurveyOperationError('NOT_ELIGIBLE', 'Survey is inactive, outside the audience, or lacks current consent.');
    return this.repo.start({ definitionId, versionId: eligible.version.id, participantRefHash: surveyParticipantHash(userId), consentEvidence: { purposeKey: eligible.version.purposeKey, consentRecordId: eligible.consentRecordId, lifecycleStage: eligible.lifecycleStage, checkedAt: new Date().toISOString() } });
  }
  async saveAnswers(input: { id: string; expectedVersion: number; userId: string; answers: Record<string, unknown> }) {
    const response = await this.repo.findResponse(input.id); if (!response || response.participantRefHash !== surveyParticipantHash(input.userId)) throw new SurveyOperationError('RESPONSE_NOT_FOUND', 'Survey response was not found.');
    const detail = await this.repo.detail(response.definitionId); if (!detail || detail.version.id !== response.versionId) throw new SurveyOperationError('VERSION_NOT_FOUND', 'Immutable survey version was not found.');
    const errors = validateSurveyAnswers(detail.version.questions, input.answers); if (errors.length) throw new SurveyOperationError('INVALID_ANSWERS', errors[0]);
    const saved = await this.repo.saveAnswers({ id: input.id, expectedVersion: input.expectedVersion, participantRefHash: response.participantRefHash, answers: input.answers });
    if (!saved) throw new SurveyOperationError('STALE_VERSION', 'Response changed or is already complete.'); return saved;
  }
  async complete(input: { id: string; expectedVersion: number; userId: string }) {
    const response = await this.repo.findResponse(input.id); if (!response || response.participantRefHash !== surveyParticipantHash(input.userId)) throw new SurveyOperationError('RESPONSE_NOT_FOUND', 'Survey response was not found.');
    const detail = await this.repo.detail(response.definitionId); if (!detail) throw new SurveyOperationError('SURVEY_NOT_FOUND', 'Survey was not found.');
    const errors = validateSurveyAnswers(detail.version.questions, response.answers); if (errors.length) throw new SurveyOperationError('INCOMPLETE_RESPONSE', errors[0]);
    const eligible = (await this.repo.eligible(input.userId)).some((item) => item.definition.id === response.definitionId && item.version.id === response.versionId);
    if (!eligible) throw new SurveyOperationError('CONSENT_OR_AUDIENCE_CHANGED', 'Consent, audience, or survey status changed before completion.');
    const complete = await this.repo.complete({ id: input.id, expectedVersion: input.expectedVersion, participantRefHash: response.participantRefHash }); if (!complete) throw new SurveyOperationError('STALE_VERSION', 'Response changed or is already complete.'); return complete;
  }
  analysis(id: string) { return this.repo.analysis(id); }
  export(id: string) { return this.repo.exportRows(id); }
}
