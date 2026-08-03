import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { campaignSendDecisions, campaignSendRuns } from '../schema/campaignSendRuns';
import { consentCurrentState } from '../schema/consent';
import { channelSuppressions } from '../schema/consent-foundation';
import { cartAbandonments } from '../schema/abandonment';
import {
  SendAudienceSubject,
  SendGateReads,
  SendRunSink,
} from '../../../application/use-cases/campaigns/CampaignSendEngineUseCase';

/**
 * Gate reads + run persistence for the dry-run send engine. Consent reads the
 * denormalized advertising grant; suppression reads ACTIVE channel suppressions by
 * customer identity ref; the frequency memory is the decision ledger itself.
 */
export class DrizzleCampaignSendRepository implements SendGateReads, SendRunSink {
  async audienceFromOpenAbandonments(): Promise<SendAudienceSubject[]> {
    const rows = await db
      .select({ subjectRef: cartAbandonments.cartId, ownerKind: cartAbandonments.ownerKind, ownerId: cartAbandonments.ownerId })
      .from(cartAbandonments)
      .where(eq(cartAbandonments.status, 'OPEN'))
      .limit(1000);
    return rows;
  }

  async advertisingGrantedUserIds(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await db
      .select({ userId: consentCurrentState.userId })
      .from(consentCurrentState)
      .where(and(inArray(consentCurrentState.userId, userIds), eq(consentCurrentState.advertisingGranted, true)));
    return new Set(rows.map((r) => r.userId).filter((v): v is string => !!v));
  }

  async suppressedUserIds(userIds: string[], channelKey: string): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await db
      .select({ ref: channelSuppressions.customerIdentityRef })
      .from(channelSuppressions)
      .where(
        and(
          inArray(channelSuppressions.customerIdentityRef, userIds),
          eq(channelSuppressions.channelKey, channelKey),
          eq(channelSuppressions.suppressionActive, true),
        ),
      );
    return new Set(rows.map((r) => r.ref).filter((v): v is string => !!v));
  }

  async recentlyEligibleSubjects(subjectRefs: string[], sinceDays: number): Promise<Set<string>> {
    if (subjectRefs.length === 0) return new Set();
    const since = new Date(Date.now() - sinceDays * 24 * 3600_000);
    const rows = await db
      .select({ subjectRef: campaignSendDecisions.subjectRef })
      .from(campaignSendDecisions)
      .where(
        and(
          inArray(campaignSendDecisions.subjectRef, subjectRefs),
          eq(campaignSendDecisions.decision, 'ELIGIBLE'),
          gt(campaignSendDecisions.createdAt, since),
        ),
      );
    return new Set(rows.map((r) => r.subjectRef));
  }

  async persist(run: Parameters<SendRunSink['persist']>[0]): Promise<{ runId: string }> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(campaignSendRuns)
        .values({
          campaignId: run.campaignId,
          candidates: run.counts.candidates,
          eligible: run.counts.eligible,
          excludedNoIdentity: run.counts.noIdentity,
          excludedNoConsent: run.counts.noConsent,
          excludedSuppressed: run.counts.suppressed,
          excludedFrequency: run.counts.frequency,
          quietHoursAtRun: run.quietHoursAtRun ? 'YES' : 'NO',
          createdBy: run.createdBy,
        })
        .returning({ id: campaignSendRuns.id });
      if (run.decisions.length > 0) {
        await tx.insert(campaignSendDecisions).values(
          run.decisions.map((d) => ({ runId: row.id, subjectRef: d.subjectRef, decision: d.decision, detail: d.detail })),
        );
      }
      return { runId: row.id };
    });
  }

  async listRuns(campaignId: string) {
    return db.select().from(campaignSendRuns).where(eq(campaignSendRuns.campaignId, campaignId)).orderBy(desc(campaignSendRuns.createdAt)).limit(20);
  }

  async runDecisions(runId: string) {
    const [run] = await db.select().from(campaignSendRuns).where(eq(campaignSendRuns.id, runId)).limit(1);
    if (!run) return null;
    const byDecision = await db
      .select({ decision: campaignSendDecisions.decision, count: sql<number>`count(*)::int` })
      .from(campaignSendDecisions)
      .where(eq(campaignSendDecisions.runId, runId))
      .groupBy(campaignSendDecisions.decision);
    const sample = await db.select().from(campaignSendDecisions).where(eq(campaignSendDecisions.runId, runId)).limit(50);
    return { run, byDecision, sample };
  }
}
