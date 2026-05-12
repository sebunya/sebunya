import { db } from "../client";
import { recommendationRules } from "../schema/recommendations";
import { and, eq, ne, sql, desc, asc, or, ilike, gte, lte, isNull } from "drizzle-orm";
import type {
  IRecommendationRuleRepository,
  FindAdminRulesInput,
} from "../../../application/ports/IRecommendationRuleRepository";
import type {
  RecommendationRule,
  RecommendationRuleStatus,
  RecommendationRuleType,
  RecommendationRuleTargetType,
  RecommendationRuleCondition,
  RecommendationRuleAction,
} from "../../../domain/recommendations/RecommendationRuleTypes";
import type { RecommendationPlacement } from "../../../domain/recommendations/RecommendationTypes";

export class DrizzleRecommendationRuleRepository implements IRecommendationRuleRepository {
  
  async create(rule: Omit<RecommendationRule, "id" | "createdAt" | "updatedAt">): Promise<RecommendationRule> {
    const [inserted] = await db
      .insert(recommendationRules)
      .values({
        name: rule.name,
        description: rule.description,
        type: rule.type,
        status: rule.status,
        priority: rule.priority,
        placement: rule.placement,
        targetType: rule.targetType,
        targetValue: rule.targetValue,
        conditions: rule.conditions as any,
        action: rule.action as any,
        startsAt: rule.startsAt,
        endsAt: rule.endsAt,
        createdBy: rule.createdBy,
        updatedBy: rule.updatedBy,
      })
      .returning();

    return this.mapRow(inserted);
  }

  async update(id: string, patch: Partial<RecommendationRule>): Promise<RecommendationRule> {
    const updates: any = { ...patch, updatedAt: new Date() };
    delete updates.id;
    delete updates.createdAt;

    const [updated] = await db
      .update(recommendationRules)
      .set(updates)
      .where(eq(recommendationRules.id, id))
      .returning();

    if (!updated) {
      throw new Error(`Recommendation Rule with id ${id} not found for update`);
    }

    return this.mapRow(updated);
  }

  async findById(id: string): Promise<RecommendationRule | null> {
    const [row] = await db
      .select()
      .from(recommendationRules)
      .where(eq(recommendationRules.id, id))
      .limit(1);

    return row ? this.mapRow(row) : null;
  }

  async findActiveRulesForPlacement(input: {
    placement: RecommendationPlacement;
    now?: Date;
  }): Promise<RecommendationRule[]> {
    const checkTime = input.now ?? new Date();

    const rows = await db
      .select()
      .from(recommendationRules)
      .where(
        and(
          eq(recommendationRules.placement, input.placement),
          eq(recommendationRules.status, "ACTIVE"),
          or(
            isNull(recommendationRules.startsAt),
            lte(recommendationRules.startsAt, checkTime)
          ),
          or(
            isNull(recommendationRules.endsAt),
            gte(recommendationRules.endsAt, checkTime)
          )
        )
      )
      .orderBy(asc(recommendationRules.priority), desc(recommendationRules.createdAt));

    return rows.map(row => this.mapRow(row));
  }

  async findAdminRules(input: FindAdminRulesInput): Promise<RecommendationRule[]> {
    const conditions = this.buildAdminConditions(input);
    const limit = input.pageSize ?? 20;
    const offset = ((input.page ?? 1) - 1) * limit;

    const rows = await db
      .select()
      .from(recommendationRules)
      .where(and(...conditions))
      .orderBy(asc(recommendationRules.priority), desc(recommendationRules.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map(row => this.mapRow(row));
  }

  async countAdminRules(input: FindAdminRulesInput): Promise<number> {
    const conditions = this.buildAdminConditions(input);

    const [res] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(recommendationRules)
      .where(and(...conditions));

    return res?.count ?? 0;
  }

  async archive(id: string): Promise<void> {
    await db
      .update(recommendationRules)
      .set({ status: "ARCHIVED", updatedAt: new Date() })
      .where(eq(recommendationRules.id, id));
  }

  async changeStatus(id: string, status: RecommendationRuleStatus): Promise<void> {
    await db
      .update(recommendationRules)
      .set({ status, updatedAt: new Date() })
      .where(eq(recommendationRules.id, id));
  }

  async findConflictingRules(rule: RecommendationRule): Promise<RecommendationRule[]> {
    // Conflict check constraints, specifically targeting explicit overlapping ACTIVE rules 
    // targeting the exact same vectors.
    const conditions: any[] = [
      eq(recommendationRules.status, "ACTIVE"),
      eq(recommendationRules.placement, rule.placement),
      eq(recommendationRules.type, rule.type)
    ];

    if (rule.id) {
      conditions.push(ne(recommendationRules.id, rule.id));
    }

    // Target value overlaps
    if (rule.targetValue) {
      conditions.push(
        and(
          eq(recommendationRules.targetType, rule.targetType),
          eq(recommendationRules.targetValue, rule.targetValue as string)
        )
      );
    }

    const rows = await db
      .select()
      .from(recommendationRules)
      .where(and(...conditions));

    return rows.map(row => this.mapRow(row));
  }

  private buildAdminConditions(input: FindAdminRulesInput): any[] {
    const c: any[] = [];

    if (input.placement) c.push(eq(recommendationRules.placement, input.placement));
    if (input.type) c.push(eq(recommendationRules.type, input.type));
    if (input.status) {
      c.push(eq(recommendationRules.status, input.status));
    } else {
      // Default filter out archived if not explicitly requested?
      // Or just show all. Prompt implies ARCHIVED exists so we usually filter on it or show.
      // Let's allow explicit "all" by omitting, but generally follow passed status.
    }
    if (input.targetType) c.push(eq(recommendationRules.targetType, input.targetType));
    if (input.targetValue) c.push(eq(recommendationRules.targetValue, input.targetValue));
    
    if (input.search) {
      const likeSearch = `%${input.search}%`;
      c.push(
        or(
          ilike(recommendationRules.name, likeSearch),
          ilike(recommendationRules.description, likeSearch),
          ilike(recommendationRules.targetValue, likeSearch)
        )
      );
    }


    return c;
  }

  private mapRow(row: any): RecommendationRule {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      type: row.type as RecommendationRuleType,
      status: row.status as RecommendationRuleStatus,
      priority: row.priority,
      placement: row.placement as RecommendationPlacement,
      targetType: row.targetType as RecommendationRuleTargetType,
      targetValue: row.targetValue ?? undefined,
      conditions: (row.conditions ?? {}) as RecommendationRuleCondition,
      action: (row.action ?? {}) as RecommendationRuleAction,
      startsAt: row.startsAt ? new Date(row.startsAt) : undefined,
      endsAt: row.endsAt ? new Date(row.endsAt) : undefined,
      createdBy: row.createdBy ?? undefined,
      updatedBy: row.updatedBy ?? undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
}
