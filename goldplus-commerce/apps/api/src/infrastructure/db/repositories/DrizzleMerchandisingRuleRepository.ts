import { and, eq, or, isNull, gt, lte, desc } from 'drizzle-orm';
import { db } from '../client';
import { recommendationMerchandisingRules } from '../schema/recommendations';
import { IMerchandisingRuleRepository } from '../../../application/ports/IRecommendationAdminRepositories';
import { AdminMerchandisingRule, MerchandisingAction, MerchandisingScope } from '../../../domain/recommendation/AdminMerchandising';
import { RecommendationSurface } from '../../../domain/recommendation/RecommendationTypes';

type Row = typeof recommendationMerchandisingRules.$inferSelect;

function toRule(r: Row): AdminMerchandisingRule {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    enabled: r.enabled,
    action: r.action as MerchandisingAction,
    scope: r.scope as MerchandisingScope,
    surface: (r.surface as RecommendationSurface) ?? null,
    productId: r.productId ?? null,
    categoryId: r.categoryId ?? null,
    anchorProductId: r.anchorProductId ?? null,
    weight: r.weight ?? null,
    priority: r.priority,
    startsAt: r.startsAt ?? null,
    endsAt: r.endsAt ?? null,
    reason: r.reason ?? null,
  };
}

export class DrizzleMerchandisingRuleRepository implements IMerchandisingRuleRepository {
  async list(): Promise<AdminMerchandisingRule[]> {
    const rows = await db.query.recommendationMerchandisingRules.findMany({
      orderBy: [desc(recommendationMerchandisingRules.priority)],
    });
    return rows.map(toRule);
  }

  async findById(id: string): Promise<AdminMerchandisingRule | null> {
    const row = await db.query.recommendationMerchandisingRules.findFirst({ where: eq(recommendationMerchandisingRules.id, id) });
    return row ? toRule(row) : null;
  }

  async create(input: Omit<AdminMerchandisingRule, 'id'>, createdBy: string): Promise<AdminMerchandisingRule> {
    const [row] = await db
      .insert(recommendationMerchandisingRules)
      .values({
        name: input.name,
        description: input.description,
        enabled: input.enabled,
        action: input.action,
        scope: input.scope,
        surface: input.surface ?? null,
        productId: input.productId ?? null,
        categoryId: input.categoryId ?? null,
        anchorProductId: input.anchorProductId ?? null,
        weight: input.weight ?? null,
        priority: input.priority,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        reason: input.reason ?? null,
        createdBy,
      })
      .returning();
    return toRule(row);
  }

  async update(id: string, patch: Partial<Omit<AdminMerchandisingRule, 'id'>>): Promise<AdminMerchandisingRule | null> {
    const [row] = await db
      .update(recommendationMerchandisingRules)
      .set({ ...patch, surface: patch.surface ?? undefined, updatedAt: new Date() })
      .where(eq(recommendationMerchandisingRules.id, id))
      .returning();
    return row ? toRule(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await db
      .delete(recommendationMerchandisingRules)
      .where(eq(recommendationMerchandisingRules.id, id))
      .returning({ id: recommendationMerchandisingRules.id });
    return deleted.length > 0;
  }

  async listActiveForSurface(surface: RecommendationSurface, now: Date): Promise<AdminMerchandisingRule[]> {
    const t = recommendationMerchandisingRules;
    const rows = await db.query.recommendationMerchandisingRules.findMany({
      where: and(
        eq(t.enabled, true),
        or(isNull(t.startsAt), lte(t.startsAt, now)),
        or(isNull(t.endsAt), gt(t.endsAt, now)),
        // surface-scoped rules must match; other scopes apply everywhere
        or(eq(t.scope, 'global'), eq(t.scope, 'category'), eq(t.scope, 'product'), eq(t.scope, 'anchor_product'), eq(t.surface, surface)),
      ),
      orderBy: [desc(t.priority)],
    });
    return rows.map(toRule);
  }
}
