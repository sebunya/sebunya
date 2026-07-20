import { SurveyAudience, SurveyQuestion, SurveyStatus } from '../../domain/surveys/Survey';

export interface SurveyDefinitionRecord { id: string; key: string; status: SurveyStatus; version: number; currentVersionId: string; createdBy: string; approvedBy: string | null; createdAt: Date; updatedAt: Date; }
export interface SurveyVersionRecord { id: string; definitionId: string; versionNumber: number; title: string; description: string; purposeKey: string; questions: SurveyQuestion[]; audience: SurveyAudience; contentDigest: string; }
export interface SurveyResponseRecord { id: string; definitionId: string; versionId: string; participantRefHash: string; consentEvidence: Record<string, unknown>; answers: Record<string, unknown>; status: 'IN_PROGRESS' | 'COMPLETED'; version: number; startedAt: Date; completedAt: Date | null; }

export interface ISurveyRepository {
  create(input: { key: string; title: string; description: string; purposeKey: string; questions: SurveyQuestion[]; audience: SurveyAudience; contentDigest: string; actorId: string }): Promise<SurveyDefinitionRecord>;
  list(): Promise<Array<SurveyDefinitionRecord & { title: string; responseCount: number }>>;
  detail(id: string): Promise<{ definition: SurveyDefinitionRecord; version: SurveyVersionRecord; events: unknown[] } | null>;
  transition(input: { id: string; expectedVersion: number; from: SurveyStatus[]; to: SurveyStatus; actorId: string; reason: string; requireDifferentActor?: boolean }): Promise<SurveyDefinitionRecord | null>;
  eligible(userId: string): Promise<Array<{ definition: SurveyDefinitionRecord; version: SurveyVersionRecord; lifecycleStage: string; consentRecordId: string }>>;
  start(input: { definitionId: string; versionId: string; participantRefHash: string; consentEvidence: Record<string, unknown> }): Promise<SurveyResponseRecord>;
  findResponse(id: string): Promise<SurveyResponseRecord | null>;
  saveAnswers(input: { id: string; expectedVersion: number; participantRefHash: string; answers: Record<string, unknown> }): Promise<SurveyResponseRecord | null>;
  complete(input: { id: string; expectedVersion: number; participantRefHash: string }): Promise<SurveyResponseRecord | null>;
  analysis(id: string): Promise<{ total: number; completed: number; answers: Record<string, Record<string, number>> }>;
  exportRows(id: string): Promise<Array<{ responseId: string; answers: Record<string, unknown>; completedAt: Date | null }>>;
}
