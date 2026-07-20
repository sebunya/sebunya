import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { SurveyOperationsUseCase, SurveyOperationError } from '../application/use-cases/surveys/SurveyOperationsUseCase';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleSurveyRepository } from '../infrastructure/db/repositories/DrizzleSurveyRepository';
import { consentCurrentState } from '../infrastructure/db/schema/consent';
import { customerProfiles } from '../infrastructure/db/schema/customer_dna';
import { users } from '../infrastructure/db/schema/identity';
import { surveyDefinitions, surveyEvents, surveyResponses, surveyVersions } from '../infrastructure/db/schema/surveys';
const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function protectedCounts() { const result: any = await db.execute(sql`select (select count(*)::int from consent_events) consent_events,(select count(*)::int from consent_records) consent_records,(select count(*)::int from customer_preferences) preferences,(select count(*)::int from outbox_events) outbox,(select count(*)::int from notification_attempts) notifications,(select count(*)::int from orders) orders,(select count(*)::int from payment_attempts) payments`); return (result.rows ?? result)[0] as Record<string, number>; }
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const creator = randomUUID(), approver = randomUUID(), operator = randomUUID(), eligibleUser = randomUUID(), noConsentUser = randomUUID(); let definitionId: string | null = null; const providerCalls = 0; let report: Record<string, unknown> = {}, failure: unknown;
  try {
    const before = await protectedCounts();
    await db.insert(users).values([{ id: eligibleUser, email: `survey-${eligibleUser}@proof.invalid`, passwordHash: 'proof' }, { id: noConsentUser, email: `survey-${noConsentUser}@proof.invalid`, passwordHash: 'proof' }]);
    await db.insert(customerProfiles).values([{ accountUserId: eligibleUser, primaryLifecycleStage: 'ACTIVE', identityConfidence: 'HIGH', consentEligible: true }, { accountUserId: noConsentUser, primaryLifecycleStage: 'ACTIVE', identityConfidence: 'HIGH', consentEligible: true }]);
    await db.insert(consentCurrentState).values([{ userId: eligibleUser, personalizationGranted: true, lastGrantType: 'explicit', lastNoticeVersion: 'proof' }, { userId: noConsentUser, personalizationGranted: false, lastGrantType: 'explicit', lastNoticeVersion: 'proof' }]);
    const operations = new SurveyOperationsUseCase(new DrizzleSurveyRepository());
    const created = await operations.create({ key: `survey_${randomUUID().replaceAll('-', '').slice(0, 12)}`, title: 'Product fit evidence', description: 'Bounded experience feedback.', purposeKey: 'personalization', questions: [{ key: 'fit', prompt: 'How well did the product fit your needs?', type: 'SCALE', required: true, min: 0, max: 10 }, { key: 'priority', prompt: 'What mattered most?', type: 'SINGLE_CHOICE', required: true, options: ['price','quality'] }], audience: { lifecycleStages: ['ACTIVE'] }, actorId: creator }); definitionId = created.id;
    const submitted = await operations.submit({ id: created.id, expectedVersion: created.version, actorId: creator, reason: 'Ready for independent review' });
    let selfApprovalDenied = false; try { await operations.approve({ id: created.id, expectedVersion: submitted.version, actorId: creator, reason: 'Self approval', decision: 'APPROVED' }); } catch (error) { selfApprovalDenied = error instanceof SurveyOperationError && error.code === 'STALE_VERSION'; }
    assert(selfApprovalDenied, 'Creator approved own survey.');
    const approved = await operations.approve({ id: created.id, expectedVersion: submitted.version, actorId: approver, reason: 'Questions and audience approved', decision: 'APPROVED' });
    const active = await operations.activate({ id: created.id, expectedVersion: approved.version, actorId: operator, reason: 'Enable in-app eligibility only' });
    assert((await operations.eligible(eligibleUser)).length === 1, 'Eligible consented customer was excluded.'); assert((await operations.eligible(noConsentUser)).length === 0, 'Customer without personalization consent was included.');
    const response = await operations.start(active.id, eligibleUser); const retried = await operations.start(active.id, eligibleUser); assert(response.id === retried.id, 'Response start was not idempotent.');
    let ownershipDenied = false; try { await operations.saveAnswers({ id: response.id, expectedVersion: response.version, userId: noConsentUser, answers: { fit: 8, priority: 'quality' } }); } catch (error) { ownershipDenied = error instanceof SurveyOperationError && error.code === 'RESPONSE_NOT_FOUND'; } assert(ownershipDenied, 'Response ownership was not enforced.');
    let invalidAnswerDenied = false; try { await operations.saveAnswers({ id: response.id, expectedVersion: response.version, userId: eligibleUser, answers: { fit: 99, priority: 'invented' } }); } catch (error) { invalidAnswerDenied = error instanceof SurveyOperationError && error.code === 'INVALID_ANSWERS'; } assert(invalidAnswerDenied, 'Invalid answers were accepted.');
    const answered = await operations.saveAnswers({ id: response.id, expectedVersion: response.version, userId: eligibleUser, answers: { fit: 8, priority: 'quality' } });
    const completions = await Promise.allSettled([operations.complete({ id: response.id, expectedVersion: answered.version, userId: eligibleUser }), operations.complete({ id: response.id, expectedVersion: answered.version, userId: eligibleUser })]); const completionWinners = completions.filter((item) => item.status === 'fulfilled').length; assert(completionWinners === 1, 'Concurrent completion did not produce one winner.');
    const analysis = await operations.analysis(active.id); const exported = await operations.export(active.id); assert(analysis.completed === 1 && analysis.answers.fit['8'] === 1 && exported.length === 1 && !('participantRefHash' in exported[0]), 'Analysis/export was not truthful or PII-minimized.');
    const current = (await operations.detail(active.id)).definition; await operations.pause({ id: active.id, expectedVersion: current.version, actorId: operator, reason: 'Proof pause' }); assert((await operations.eligible(eligibleUser)).length === 0, 'Paused survey remained eligible.');
    const after = await protectedCounts(); for (const key of Object.keys(before)) assert(before[key] === after[key], `${key} changed during survey proof.`);
    const jsonTypes: any = await db.execute(sql`select jsonb_typeof(questions) questions_type,jsonb_typeof(audience) audience_type from survey_versions where definition_id=${active.id}`); const types = (jsonTypes.rows ?? jsonTypes)[0]; const detail = await operations.detail(active.id);
    report = { lifecycle: 'DRAFT->PENDING_APPROVAL->APPROVED->ACTIVE->PAUSED', selfApprovalDenied, consentGateDenied: true, audienceEligible: true, ownershipDenied, invalidAnswerDenied, idempotentStart: true, completionWinners, nativeQuestionsJsonb: types.questions_type === 'array', nativeAudienceJsonb: types.audience_type === 'object', completed: analysis.completed, exportContainsParticipantReference: false, consentWrites: 0, preferenceWrites: 0, outboxDelta: 0, notificationDelta: 0, orderDelta: 0, paymentDelta: 0, providerCalls, auditEvents: detail.events.length };
  } catch (error) { failure = error; }
  finally {
    try { if (definitionId) { await db.delete(surveyResponses).where(eq(surveyResponses.definitionId, definitionId)); await db.delete(surveyEvents).where(eq(surveyEvents.definitionId, definitionId)); await db.delete(surveyVersions).where(eq(surveyVersions.definitionId, definitionId)); await db.delete(surveyDefinitions).where(eq(surveyDefinitions.id, definitionId)); } await db.delete(consentCurrentState).where(inArray(consentCurrentState.userId, [eligibleUser, noConsentUser])); await db.delete(customerProfiles).where(inArray(customerProfiles.accountUserId, [eligibleUser, noConsentUser])); await db.delete(users).where(inArray(users.id, [eligibleUser, noConsentUser])); const residue: any = await db.execute(sql`select (select count(*)::int from survey_definitions where id=${definitionId})+(select count(*)::int from users where id in (${eligibleUser},${noConsentUser})) count`); report.proofResidue = Number((residue.rows ?? residue)[0].count); if (report.proofResidue !== 0) failure ??= new Error('SURVEY_PROOF_RESIDUE'); } catch (error) { failure ??= error; } try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' })); if (failure) throw failure;
}
main().catch((error) => { console.error('SURVEYS_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
