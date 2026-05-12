import { db } from "../client";
import { recommendationRuleAuditLogs } from "../schema/recommendations";
import { eq, desc } from "drizzle-orm";
import type {
  IRecommendationRuleAuditRepository,
  RuleAuditRecord,
} from "../../../application/ports/IRecommendationRuleAuditRepository";

export class DrizzleRecommendationRuleAuditRepository implements IRecommendationRuleAuditRepository {
  async record(event: RuleAuditRecord): Promise<void> {
    await db
      .insert(recommendationRuleAuditLogs)
      .values({
        ruleId: event.ruleId,
        action: event.action,
        before: event.before as any,
        after: event.after as any,
        performedBy: event.performedBy,
        performedAt: event.performedAt ?? new Date(),
        metadata: event.metadata as any || {},
      });
  }

  async findByRuleId(ruleId: string): Promise<RuleAuditRecord[]> {
    const rows = await db
      .select()
      .from(recommendationRuleAuditLogs)
      .where(eq(recommendationRuleAuditLogs.ruleId, ruleId))
      .orderBy(desc(recommendationRuleAuditLogs.performedAt));

    return rows.map(r => ({
      id: r.id,
      ruleId: r.ruleId ?? undefined,
      action: r.action,
      before: r.before,
      after: r.after,
      performedBy: r.performedBy,
      performedAt: new Date(r.performedAt),
      metadata: (r.metadata as Record<string, any>) || {},
    }));
  }
}
