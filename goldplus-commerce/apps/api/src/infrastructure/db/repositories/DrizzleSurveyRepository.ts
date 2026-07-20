import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { ISurveyRepository, SurveyDefinitionRecord, SurveyResponseRecord, SurveyVersionRecord } from '../../../application/ports/ISurveyRepository';
import { SurveyAudience, SurveyQuestion, SurveyStatus } from '../../../domain/surveys/Survey';
import { client, db } from '../client';
import { consentCurrentState } from '../schema/consent';
import { customerProfiles } from '../schema/customer_dna';
import { surveyDefinitions, surveyEvents, surveyResponses, surveyVersions } from '../schema/surveys';

const jsonb = (value: unknown) => sql`${client.json(value as any)}::jsonb`;
const definitionRecord = (row: typeof surveyDefinitions.$inferSelect): SurveyDefinitionRecord => ({ ...row, status: row.status as SurveyStatus });
const versionRecord = (row: typeof surveyVersions.$inferSelect): SurveyVersionRecord => ({ ...row, questions: row.questions as SurveyQuestion[], audience: row.audience as SurveyAudience });
const responseRecord = (row: typeof surveyResponses.$inferSelect): SurveyResponseRecord => ({ ...row, status: row.status as SurveyResponseRecord['status'], consentEvidence: row.consentEvidence as Record<string, unknown>, answers: row.answers as Record<string, unknown> });

export class DrizzleSurveyRepository implements ISurveyRepository {
  private event(tx: any, input: { definitionId: string; actorId: string; action: string; reason: string; evidence: Record<string, unknown> }) {
    return tx.insert(surveyEvents).values({ ...input, evidence: jsonb(input.evidence) as any });
  }
  async create(input: { key: string; title: string; description: string; purposeKey: string; questions: SurveyQuestion[]; audience: SurveyAudience; contentDigest: string; actorId: string }) {
    return db.transaction(async (tx) => {
      const definitionId = randomUUID(); const versionId = randomUUID();
      const [definition] = await tx.insert(surveyDefinitions).values({ id: definitionId, key: input.key, currentVersionId: versionId, createdBy: input.actorId }).returning();
      await tx.insert(surveyVersions).values({ id: versionId, definitionId, versionNumber: 1, title: input.title, description: input.description, purposeKey: input.purposeKey, questions: jsonb(input.questions) as any, audience: jsonb(input.audience) as any, contentDigest: input.contentDigest, createdBy: input.actorId });
      await this.event(tx, { definitionId, actorId: input.actorId, action: 'CREATED', reason: 'Immutable survey version created.', evidence: { versionId, versionNumber: 1, contentDigest: input.contentDigest } });
      return definitionRecord(definition);
    });
  }
  async list() {
    const rows = await db.select({ definition: surveyDefinitions, title: surveyVersions.title, responseCount: sql<number>`count(${surveyResponses.id})::int` }).from(surveyDefinitions).innerJoin(surveyVersions, eq(surveyVersions.id, surveyDefinitions.currentVersionId)).leftJoin(surveyResponses, eq(surveyResponses.definitionId, surveyDefinitions.id)).groupBy(surveyDefinitions.id, surveyVersions.title).orderBy(desc(surveyDefinitions.updatedAt));
    return rows.map((row) => ({ ...definitionRecord(row.definition), title: row.title, responseCount: row.responseCount }));
  }
  async detail(id: string) {
    const rows = await db.select({ definition: surveyDefinitions, version: surveyVersions }).from(surveyDefinitions).innerJoin(surveyVersions, eq(surveyVersions.id, surveyDefinitions.currentVersionId)).where(eq(surveyDefinitions.id, id)).limit(1);
    if (!rows[0]) return null;
    const events = await db.select().from(surveyEvents).where(eq(surveyEvents.definitionId, id)).orderBy(asc(surveyEvents.createdAt));
    return { definition: definitionRecord(rows[0].definition), version: versionRecord(rows[0].version), events };
  }
  async transition(input: { id: string; expectedVersion: number; from: SurveyStatus[]; to: SurveyStatus; actorId: string; reason: string; requireDifferentActor?: boolean }) {
    return db.transaction(async (tx) => {
      const conditions = [eq(surveyDefinitions.id, input.id), eq(surveyDefinitions.version, input.expectedVersion), inArray(surveyDefinitions.status, input.from)];
      if (input.requireDifferentActor) conditions.push(sql`${surveyDefinitions.createdBy} <> ${input.actorId}::uuid`);
      const [row] = await tx.update(surveyDefinitions).set({ status: input.to, approvedBy: input.to === 'APPROVED' ? input.actorId : undefined, version: sql`${surveyDefinitions.version} + 1`, updatedAt: new Date() }).where(and(...conditions)).returning();
      if (!row) return null;
      await this.event(tx, { definitionId: input.id, actorId: input.actorId, action: input.to, reason: input.reason, evidence: { from: input.from, to: input.to, version: row.version } });
      return definitionRecord(row);
    });
  }
  async eligible(userId: string) {
    const profileRows = await db.select().from(customerProfiles).where(and(eq(customerProfiles.accountUserId, userId), eq(customerProfiles.consentEligible, true))).limit(1);
    const consentRows = await db.select().from(consentCurrentState).where(and(eq(consentCurrentState.userId, userId), eq(consentCurrentState.personalizationGranted, true), sql`${consentCurrentState.expiresAt} is null or ${consentCurrentState.expiresAt} > now()`)).limit(1);
    if (!profileRows[0] || !consentRows[0]) return [];
    const rows = await db.select({ definition: surveyDefinitions, version: surveyVersions }).from(surveyDefinitions).innerJoin(surveyVersions, eq(surveyVersions.id, surveyDefinitions.currentVersionId)).where(eq(surveyDefinitions.status, 'ACTIVE'));
    return rows.filter((row) => { const audience = row.version.audience as SurveyAudience; return audience.lifecycleStages.length === 0 || audience.lifecycleStages.includes(profileRows[0].primaryLifecycleStage); }).map((row) => ({ definition: definitionRecord(row.definition), version: versionRecord(row.version), lifecycleStage: profileRows[0].primaryLifecycleStage, consentRecordId: consentRows[0].lastConsentRecordId ?? consentRows[0].id }));
  }
  async start(input: { definitionId: string; versionId: string; participantRefHash: string; consentEvidence: Record<string, unknown> }) {
    const inserted = await db.insert(surveyResponses).values({ definitionId: input.definitionId, versionId: input.versionId, participantRefHash: input.participantRefHash, consentEvidence: jsonb(input.consentEvidence) as any, answers: jsonb({}) as any }).onConflictDoNothing({ target: [surveyResponses.definitionId, surveyResponses.participantRefHash] }).returning();
    if (inserted[0]) return responseRecord(inserted[0]);
    const [existing] = await db.select().from(surveyResponses).where(and(eq(surveyResponses.definitionId, input.definitionId), eq(surveyResponses.participantRefHash, input.participantRefHash))).limit(1);
    return responseRecord(existing);
  }
  async findResponse(id: string) { const [row] = await db.select().from(surveyResponses).where(eq(surveyResponses.id, id)).limit(1); return row ? responseRecord(row) : null; }
  async saveAnswers(input: { id: string; expectedVersion: number; participantRefHash: string; answers: Record<string, unknown> }) {
    const [row] = await db.update(surveyResponses).set({ answers: jsonb(input.answers) as any, version: sql`${surveyResponses.version} + 1` }).where(and(eq(surveyResponses.id, input.id), eq(surveyResponses.version, input.expectedVersion), eq(surveyResponses.participantRefHash, input.participantRefHash), eq(surveyResponses.status, 'IN_PROGRESS'))).returning(); return row ? responseRecord(row) : null;
  }
  async complete(input: { id: string; expectedVersion: number; participantRefHash: string }) {
    const [row] = await db.update(surveyResponses).set({ status: 'COMPLETED', completedAt: new Date(), version: sql`${surveyResponses.version} + 1` }).where(and(eq(surveyResponses.id, input.id), eq(surveyResponses.version, input.expectedVersion), eq(surveyResponses.participantRefHash, input.participantRefHash), eq(surveyResponses.status, 'IN_PROGRESS'))).returning(); return row ? responseRecord(row) : null;
  }
  async analysis(id: string) {
    const rows = await db.select().from(surveyResponses).where(eq(surveyResponses.definitionId, id)); const answers: Record<string, Record<string, number>> = {};
    for (const row of rows.filter((item) => item.status === 'COMPLETED')) for (const [key, raw] of Object.entries(row.answers as Record<string, unknown>)) { answers[key] ??= {}; for (const value of Array.isArray(raw) ? raw : [raw]) { const label = String(value); answers[key][label] = (answers[key][label] ?? 0) + 1; } }
    return { total: rows.length, completed: rows.filter((row) => row.status === 'COMPLETED').length, answers };
  }
  async exportRows(id: string) { return (await db.select({ responseId: surveyResponses.id, answers: surveyResponses.answers, completedAt: surveyResponses.completedAt }).from(surveyResponses).where(and(eq(surveyResponses.definitionId, id), eq(surveyResponses.status, 'COMPLETED'))).orderBy(asc(surveyResponses.completedAt))).map((row) => ({ ...row, answers: row.answers as Record<string, unknown> })); }
}
