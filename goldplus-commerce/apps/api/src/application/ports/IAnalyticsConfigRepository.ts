/**
 * Ports for Commerce Analytics operator configuration.
 *
 * Ownership is enforced at the repository boundary: list/read return only what
 * the caller may see (own rows plus SHARED views), and mutations are scoped by
 * owner so one operator cannot rewrite another's configuration by guessing an
 * id. The use cases still check, but the query cannot leak either way.
 */

export type SavedViewScope = 'PRIVATE' | 'SHARED';

export interface AnalyticsSavedView {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  scope: SavedViewScope;
  periodDays: number | null;
  startDay: string | null;
  endDay: string | null;
  metricKeys: string[];
  filters: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedViewDraft {
  ownerId: string;
  name: string;
  description?: string | null;
  scope: SavedViewScope;
  periodDays?: number | null;
  startDay?: string | null;
  endDay?: string | null;
  metricKeys: string[];
  filters?: Record<string, unknown>;
}

export interface SavedViewPatch {
  name?: string;
  description?: string | null;
  scope?: SavedViewScope;
  periodDays?: number | null;
  startDay?: string | null;
  endDay?: string | null;
  metricKeys?: string[];
  filters?: Record<string, unknown>;
}

export interface IAnalyticsSavedViewRepository {
  /** Own views plus every SHARED view, newest first. */
  listVisibleTo(ownerId: string, limit: number): Promise<AnalyticsSavedView[]>;
  findVisible(id: string, ownerId: string): Promise<AnalyticsSavedView | null>;
  create(draft: SavedViewDraft): Promise<AnalyticsSavedView>;
  /** Scoped by owner: returns null when the row exists but is not the caller's. */
  updateOwned(id: string, ownerId: string, patch: SavedViewPatch): Promise<AnalyticsSavedView | null>;
  deleteOwned(id: string, ownerId: string): Promise<boolean>;
  countOwnedBy(ownerId: string): Promise<number>;
}

export type AlertComparison = 'ABOVE' | 'BELOW';
export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AnalyticsAlertRule {
  id: string;
  ownerId: string;
  name: string;
  metricKey: string;
  comparison: AlertComparison;
  threshold: number;
  minimumSample: number;
  evaluationDays: number;
  severity: AlertSeverity;
  enabled: boolean;
  cooldownMinutes: number;
  lastEvaluatedAt: Date | null;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertRuleDraft {
  ownerId: string;
  name: string;
  metricKey: string;
  comparison: AlertComparison;
  threshold: number;
  minimumSample: number;
  evaluationDays: number;
  severity: AlertSeverity;
  cooldownMinutes: number;
}

export interface AlertRulePatch {
  name?: string;
  comparison?: AlertComparison;
  threshold?: number;
  minimumSample?: number;
  evaluationDays?: number;
  severity?: AlertSeverity;
  enabled?: boolean;
  cooldownMinutes?: number;
}

export interface IAnalyticsAlertRuleRepository {
  listOwnedBy(ownerId: string, limit: number): Promise<AnalyticsAlertRule[]>;
  findOwned(id: string, ownerId: string): Promise<AnalyticsAlertRule | null>;
  create(draft: AlertRuleDraft): Promise<AnalyticsAlertRule>;
  updateOwned(id: string, ownerId: string, patch: AlertRulePatch): Promise<AnalyticsAlertRule | null>;
  deleteOwned(id: string, ownerId: string): Promise<boolean>;
  countOwnedBy(ownerId: string): Promise<number>;
  /** Enabled rules only — the evaluation sweep never wakes a disabled rule. */
  listEnabled(limit: number): Promise<AnalyticsAlertRule[]>;
  recordEvaluation(id: string, evaluatedAt: Date, fired: boolean): Promise<void>;
}
