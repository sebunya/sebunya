import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { analyticsAlertRules, analyticsSavedViews } from '../schema/analytics';
import {
  AlertRuleDraft,
  AlertRulePatch,
  AnalyticsAlertRule,
  AnalyticsSavedView,
  IAnalyticsAlertRuleRepository,
  IAnalyticsSavedViewRepository,
  SavedViewDraft,
  SavedViewPatch,
} from '../../../application/ports/IAnalyticsConfigRepository';

function toView(row: typeof analyticsSavedViews.$inferSelect): AnalyticsSavedView {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description ?? null,
    scope: row.scope === 'SHARED' ? 'SHARED' : 'PRIVATE',
    periodDays: row.periodDays ?? null,
    startDay: row.startDay ?? null,
    endDay: row.endDay ?? null,
    metricKeys: Array.isArray(row.metricKeys) ? (row.metricKeys as string[]) : [],
    filters: (row.filters as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleAnalyticsSavedViewRepository implements IAnalyticsSavedViewRepository {
  async listVisibleTo(ownerId: string, limit: number): Promise<AnalyticsSavedView[]> {
    const bounded = Math.max(1, Math.min(limit, 200));
    const rows = await db
      .select()
      .from(analyticsSavedViews)
      // Own rows plus SHARED rows. A PRIVATE view of another operator is not
      // merely hidden in the UI — it never leaves the database.
      .where(or(eq(analyticsSavedViews.ownerId, ownerId), eq(analyticsSavedViews.scope, 'SHARED')))
      .orderBy(desc(analyticsSavedViews.updatedAt))
      .limit(bounded);
    return rows.map(toView);
  }

  async findVisible(id: string, ownerId: string): Promise<AnalyticsSavedView | null> {
    const rows = await db
      .select()
      .from(analyticsSavedViews)
      .where(and(
        eq(analyticsSavedViews.id, id),
        or(eq(analyticsSavedViews.ownerId, ownerId), eq(analyticsSavedViews.scope, 'SHARED')),
      ))
      .limit(1);
    return rows[0] ? toView(rows[0]) : null;
  }

  async create(draft: SavedViewDraft): Promise<AnalyticsSavedView> {
    const rows = await db
      .insert(analyticsSavedViews)
      .values({
        ownerId: draft.ownerId,
        name: draft.name,
        description: draft.description ?? null,
        scope: draft.scope,
        periodDays: draft.periodDays ?? null,
        startDay: draft.startDay ?? null,
        endDay: draft.endDay ?? null,
        metricKeys: draft.metricKeys,
        filters: draft.filters ?? {},
      })
      .returning();
    return toView(rows[0]!);
  }

  async updateOwned(id: string, ownerId: string, patch: SavedViewPatch): Promise<AnalyticsSavedView | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.scope !== undefined) values.scope = patch.scope;
    if (patch.periodDays !== undefined) values.periodDays = patch.periodDays;
    if (patch.startDay !== undefined) values.startDay = patch.startDay;
    if (patch.endDay !== undefined) values.endDay = patch.endDay;
    if (patch.metricKeys !== undefined) values.metricKeys = patch.metricKeys;
    if (patch.filters !== undefined) values.filters = patch.filters;
    const rows = await db
      .update(analyticsSavedViews)
      .set(values)
      .where(and(eq(analyticsSavedViews.id, id), eq(analyticsSavedViews.ownerId, ownerId)))
      .returning();
    return rows[0] ? toView(rows[0]) : null;
  }

  async deleteOwned(id: string, ownerId: string): Promise<boolean> {
    const rows = await db
      .delete(analyticsSavedViews)
      .where(and(eq(analyticsSavedViews.id, id), eq(analyticsSavedViews.ownerId, ownerId)))
      .returning({ id: analyticsSavedViews.id });
    return rows.length > 0;
  }

  async countOwnedBy(ownerId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(analyticsSavedViews)
      .where(eq(analyticsSavedViews.ownerId, ownerId));
    return Number(rows[0]?.count ?? 0);
  }
}

function toRule(row: typeof analyticsAlertRules.$inferSelect): AnalyticsAlertRule {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    metricKey: row.metricKey,
    comparison: row.comparison === 'BELOW' ? 'BELOW' : 'ABOVE',
    threshold: Number(row.threshold),
    minimumSample: row.minimumSample,
    evaluationDays: row.evaluationDays,
    severity: row.severity as AnalyticsAlertRule['severity'],
    enabled: row.enabled,
    cooldownMinutes: row.cooldownMinutes,
    lastEvaluatedAt: row.lastEvaluatedAt ?? null,
    lastFiredAt: row.lastFiredAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleAnalyticsAlertRuleRepository implements IAnalyticsAlertRuleRepository {
  async listOwnedBy(ownerId: string, limit: number): Promise<AnalyticsAlertRule[]> {
    const bounded = Math.max(1, Math.min(limit, 200));
    const rows = await db
      .select()
      .from(analyticsAlertRules)
      .where(eq(analyticsAlertRules.ownerId, ownerId))
      .orderBy(desc(analyticsAlertRules.updatedAt))
      .limit(bounded);
    return rows.map(toRule);
  }

  async findOwned(id: string, ownerId: string): Promise<AnalyticsAlertRule | null> {
    const rows = await db
      .select()
      .from(analyticsAlertRules)
      .where(and(eq(analyticsAlertRules.id, id), eq(analyticsAlertRules.ownerId, ownerId)))
      .limit(1);
    return rows[0] ? toRule(rows[0]) : null;
  }

  async create(draft: AlertRuleDraft): Promise<AnalyticsAlertRule> {
    const rows = await db.insert(analyticsAlertRules).values({
      ownerId: draft.ownerId,
      name: draft.name,
      metricKey: draft.metricKey,
      comparison: draft.comparison,
      threshold: draft.threshold,
      minimumSample: draft.minimumSample,
      evaluationDays: draft.evaluationDays,
      severity: draft.severity,
      cooldownMinutes: draft.cooldownMinutes,
    }).returning();
    return toRule(rows[0]!);
  }

  async updateOwned(id: string, ownerId: string, patch: AlertRulePatch): Promise<AnalyticsAlertRule | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'comparison', 'threshold', 'minimumSample', 'evaluationDays', 'severity', 'enabled', 'cooldownMinutes'] as const) {
      if (patch[key] !== undefined) values[key] = patch[key];
    }
    const rows = await db
      .update(analyticsAlertRules)
      .set(values)
      .where(and(eq(analyticsAlertRules.id, id), eq(analyticsAlertRules.ownerId, ownerId)))
      .returning();
    return rows[0] ? toRule(rows[0]) : null;
  }

  async deleteOwned(id: string, ownerId: string): Promise<boolean> {
    const rows = await db
      .delete(analyticsAlertRules)
      .where(and(eq(analyticsAlertRules.id, id), eq(analyticsAlertRules.ownerId, ownerId)))
      .returning({ id: analyticsAlertRules.id });
    return rows.length > 0;
  }

  async countOwnedBy(ownerId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(analyticsAlertRules)
      .where(eq(analyticsAlertRules.ownerId, ownerId));
    return Number(rows[0]?.count ?? 0);
  }

  async listEnabled(limit: number): Promise<AnalyticsAlertRule[]> {
    const bounded = Math.max(1, Math.min(limit, 500));
    const rows = await db
      .select()
      .from(analyticsAlertRules)
      .where(eq(analyticsAlertRules.enabled, true))
      .orderBy(desc(analyticsAlertRules.updatedAt))
      .limit(bounded);
    return rows.map(toRule);
  }

  async recordEvaluation(id: string, evaluatedAt: Date, fired: boolean): Promise<void> {
    await db
      .update(analyticsAlertRules)
      .set(fired ? { lastEvaluatedAt: evaluatedAt, lastFiredAt: evaluatedAt } : { lastEvaluatedAt: evaluatedAt })
      .where(eq(analyticsAlertRules.id, id));
  }
}
