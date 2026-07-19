import { db } from '../client';
import { automationDefinitions, automationVersions, automationApprovals, automationExecutions, automationActionExecutions, automationEvents } from '../schema/automation';
import { customerProfiles } from '../schema/customer_dna';
import { and, eq, sql } from 'drizzle-orm';
import { AutomationVersionConfig, TriggerFamily } from '../../../domain/automation/Automation';

function isStaleProfileFreshness(computedAt: Date | null, now: Date, hours: number): boolean {
  if (!computedAt) return true;
  return now.getTime() - computedAt.getTime() > hours * 3_600_000;
}
import {
  IAutomationRepository, ActiveAutomation, IAutomationExecutionRepository, AutomationPlanInput, PlanPersistResult,
  IAutomationAudienceReader, AudienceResolution,
} from '../../../application/ports/IAutomationRepository';

export class DrizzleAutomationRepository implements IAutomationRepository {
  async findActiveApprovedByTrigger(triggerFamily: TriggerFamily, triggerRef: string | null, now: Date): Promise<ActiveAutomation[]> {
    // Raw execute: match the active definition's current version by trigger family
    // (+ optional ref) via jsonb accessors, which the query builder mis-renders here.
    // config jsonb is double-encoded as a JSON string in this stack, so normalise
    // to a real object before reading its keys (works whether string- or object-encoded).
    const res: any = await db.execute(sql`
      SELECT d.id AS "defId", v.id AS "verId", v.version_number AS "verNum", v.config AS "config", v.requires_approval AS "requiresApproval"
      FROM automation_definitions d
      JOIN automation_versions v ON v.definition_id = d.id AND v.version_number = d.current_version
      WHERE d.status = 'ACTIVE'
        AND (CASE WHEN jsonb_typeof(v.config) = 'string' THEN (v.config #>> '{}')::jsonb ELSE v.config END)->>'triggerFamily' = ${triggerFamily}
        AND (${triggerRef}::text IS NULL
             OR (CASE WHEN jsonb_typeof(v.config) = 'string' THEN (v.config #>> '{}')::jsonb ELSE v.config END)->>'triggerRef' = ${triggerRef}
             OR (CASE WHEN jsonb_typeof(v.config) = 'string' THEN (v.config #>> '{}')::jsonb ELSE v.config END)->>'triggerRef' IS NULL)
    `);
    const rows: { defId: string; verId: string; verNum: number; config: unknown; requiresApproval: boolean }[] = res.rows ?? res;

    const out: ActiveAutomation[] = [];
    for (const r of rows) {
      const config = (typeof r.config === 'string' ? JSON.parse(r.config) : r.config) as AutomationVersionConfig;
      let approvalValid = true;
      if (r.requiresApproval) {
        const [a] = await db.select({ id: automationApprovals.id }).from(automationApprovals)
          .where(and(eq(automationApprovals.versionId, r.verId), eq(automationApprovals.status, 'APPROVED'), sql`(${automationApprovals.expiresAt} is null or ${automationApprovals.expiresAt} > ${now})`))
          .limit(1);
        approvalValid = !!a;
      }
      if (!approvalValid) continue; // active but approval lapsed — do not plan customer-facing work
      out.push({ definitionId: r.defId, versionId: r.verId, versionNumber: r.verNum, config, requiresApproval: r.requiresApproval, approvalValid });
    }
    return out;
  }

  async isDefinitionPaused(definitionId: string): Promise<boolean> {
    const [d] = await db.select({ status: automationDefinitions.status }).from(automationDefinitions).where(eq(automationDefinitions.id, definitionId)).limit(1);
    return d?.status === 'PAUSED';
  }
}

export class DrizzleAutomationExecutionRepository implements IAutomationExecutionRepository {
  async persistPlan(input: AutomationPlanInput): Promise<PlanPersistResult> {
    const inserted = await db.insert(automationExecutions).values({
      definitionId: input.definitionId, versionId: input.versionId, versionNumber: input.versionNumber,
      triggerExecutionKey: input.triggerExecutionKey, triggerFamily: input.triggerFamily, triggerEventId: input.triggerEventId,
      subjectId: input.subjectId, windowKey: input.windowKey, status: input.status,
      plannedCount: input.status === 'ELIGIBLE' ? input.plannedActions.length : 0, ineligibleCount: input.status === 'INELIGIBLE' ? 1 : 0,
      evidence: input.evidence as object, expiresAt: input.expiresAt,
    }).onConflictDoNothing({ target: automationExecutions.triggerExecutionKey }).returning({ id: automationExecutions.id });

    if (inserted.length === 0) {
      const [existing] = await db.select({ id: automationExecutions.id }).from(automationExecutions).where(eq(automationExecutions.triggerExecutionKey, input.triggerExecutionKey)).limit(1);
      return { created: false, executionId: existing.id };
    }
    const executionId = inserted[0].id;
    if (input.plannedActions.length > 0) {
      await db.insert(automationActionExecutions).values(input.plannedActions.map((a) => ({
        executionId, actionIndex: a.actionIndex, actionFamily: a.actionFamily, idempotencyKey: a.idempotencyKey, status: 'PLANNED' as const,
      }))).onConflictDoNothing({ target: automationActionExecutions.idempotencyKey });
    }
    await db.insert(automationEvents).values({ definitionId: input.definitionId, versionId: input.versionId, executionId, eventType: 'PLANNED', toState: input.status });
    return { created: true, executionId };
  }

  async findByTriggerKey(triggerExecutionKey: string) {
    const [row] = await db.select({ id: automationExecutions.id, status: automationExecutions.status }).from(automationExecutions).where(eq(automationExecutions.triggerExecutionKey, triggerExecutionKey)).limit(1);
    return row ?? null;
  }

  async countActionsForExecution(executionId: string): Promise<number> {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(automationActionExecutions).where(eq(automationActionExecutions.executionId, executionId));
    return c?.n ?? 0;
  }
}

const STALE_PROFILE_HOURS = 72;

export class DrizzleAutomationAudienceReader implements IAutomationAudienceReader {
  async resolveSubject(subjectId: string, now: Date): Promise<AudienceResolution> {
    // subjectId is a canonical customer id — resolve from the authoritative profile.
    const [p] = await db.select().from(customerProfiles).where(eq(customerProfiles.canonicalCustomerId, subjectId)).limit(1);
    if (!p) return { outcome: 'NO_PROFILE', subjectId, lifecycleStage: null, consentEligible: null, identityConfidence: null, computedAt: null };
    if (p.identityConfidence === 'CONFLICT') return { outcome: 'IDENTITY_CONFLICT', subjectId, lifecycleStage: p.primaryLifecycleStage, consentEligible: p.consentEligible ?? null, identityConfidence: p.identityConfidence, computedAt: p.computedAt };
    const stale = isStaleProfileFreshness(p.computedAt, now, STALE_PROFILE_HOURS);
    return { outcome: stale ? 'STALE_PROFILE' : 'ELIGIBLE', subjectId, lifecycleStage: p.primaryLifecycleStage, consentEligible: p.consentEligible ?? null, identityConfidence: p.identityConfidence, computedAt: p.computedAt };
  }
}
