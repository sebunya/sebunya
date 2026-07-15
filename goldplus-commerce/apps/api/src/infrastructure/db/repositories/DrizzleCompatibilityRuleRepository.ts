import { and, eq, or, isNull, gt, lte, desc } from 'drizzle-orm';
import { db } from '../client';
import { recommendationCompatibilityRules } from '../schema/recommendations';
import { ICompatibilityRuleRepository } from '../../../application/ports/IRecommendationAdminRepositories';
import { AdminCompatibilityRule, CompatibilityRelationship } from '../../../domain/recommendation/AdminMerchandising';

type Row = typeof recommendationCompatibilityRules.$inferSelect;

function toRule(r: Row): AdminCompatibilityRule {
  return {
    id: r.id,
    anchorProductId: r.anchorProductId ?? null,
    anchorCategoryId: r.anchorCategoryId ?? null,
    candidateProductId: r.candidateProductId ?? null,
    candidateCategoryId: r.candidateCategoryId ?? null,
    relationship: r.relationship as CompatibilityRelationship,
    confidence: r.confidence,
    reasonText: r.reasonText ?? null,
    enabled: r.enabled,
    startsAt: r.startsAt ?? null,
    endsAt: r.endsAt ?? null,
  };
}

export class DrizzleCompatibilityRuleRepository implements ICompatibilityRuleRepository {
  async list(): Promise<AdminCompatibilityRule[]> {
    const rows = await db.query.recommendationCompatibilityRules.findMany({
      orderBy: [desc(recommendationCompatibilityRules.createdAt)],
    });
    return rows.map(toRule);
  }

  async findById(id: string): Promise<AdminCompatibilityRule | null> {
    const row = await db.query.recommendationCompatibilityRules.findFirst({ where: eq(recommendationCompatibilityRules.id, id) });
    return row ? toRule(row) : null;
  }

  async create(input: Omit<AdminCompatibilityRule, 'id'>, createdBy: string): Promise<AdminCompatibilityRule> {
    const [row] = await db
      .insert(recommendationCompatibilityRules)
      .values({
        anchorProductId: input.anchorProductId ?? null,
        anchorCategoryId: input.anchorCategoryId ?? null,
        candidateProductId: input.candidateProductId ?? null,
        candidateCategoryId: input.candidateCategoryId ?? null,
        relationship: input.relationship,
        confidence: input.confidence,
        reasonText: input.reasonText ?? null,
        enabled: input.enabled,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        createdBy,
      })
      .returning();
    return toRule(row);
  }

  async update(id: string, patch: Partial<Omit<AdminCompatibilityRule, 'id'>>): Promise<AdminCompatibilityRule | null> {
    const [row] = await db
      .update(recommendationCompatibilityRules)
      .set({ ...patch })
      .where(eq(recommendationCompatibilityRules.id, id))
      .returning();
    return row ? toRule(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await db
      .delete(recommendationCompatibilityRules)
      .where(eq(recommendationCompatibilityRules.id, id))
      .returning({ id: recommendationCompatibilityRules.id });
    return deleted.length > 0;
  }

  async listActiveForAnchor(input: { productId: string; categoryId: string | null; now: Date }): Promise<AdminCompatibilityRule[]> {
    const t = recommendationCompatibilityRules;
    const anchorMatch = input.categoryId
      ? or(eq(t.anchorProductId, input.productId), eq(t.anchorCategoryId, input.categoryId))
      : eq(t.anchorProductId, input.productId);
    const rows = await db.query.recommendationCompatibilityRules.findMany({
      where: and(
        eq(t.enabled, true),
        anchorMatch,
        or(isNull(t.startsAt), lte(t.startsAt, input.now)),
        or(isNull(t.endsAt), gt(t.endsAt, input.now)),
      ),
      orderBy: [desc(t.confidence)],
    });
    return rows.map(toRule);
  }
}
