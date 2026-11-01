/**
 * Saved views, alert rules and exports.
 *
 * Three rules hold throughout:
 *  - metric keys are validated against the canonical catalogue, so a saved
 *    view or an alert can never reference a metric that does not exist;
 *  - ownership is checked before every mutation and a refusal is reported as
 *    NOT_FOUND, so an operator cannot probe for another operator's row ids;
 *  - alert evaluation raises an internal action only. Nothing in this file can
 *    send an email, an SMS or a provider event, and the table it reads has no
 *    destination column to make that possible.
 */

import {
  ANALYTICS_CONTRACT_VERSION,
  ANALYTICS_TIMEZONE,
  AnalyticsActionItem,
  getMetricDefinition,
  requireMetricDefinition,
  resolveKampalaPeriod,
  VALUE_BEARING_STATES,
} from '@goldplus/shared';
import {
  AlertComparison,
  AlertSeverity,
  AnalyticsAlertRule,
  AnalyticsSavedView,
  IAnalyticsAlertRuleRepository,
  IAnalyticsSavedViewRepository,
  SavedViewScope,
} from '../../ports/IAnalyticsConfigRepository';
import { GetAnalyticsOverviewUseCase } from './CommerceAnalyticsUseCases';

/** Bounded so one operator cannot fill the table. Documented in the handoff. */
export const MAX_SAVED_VIEWS_PER_OWNER = 50;
export const MAX_ALERT_RULES_PER_OWNER = 50;
export const MAX_EXPORT_ROWS = 5_000;

export type ConfigFailure =
  | { ok: false; code: 'INVALID_INPUT'; message: string }
  | { ok: false; code: 'NOT_FOUND'; message: string }
  | { ok: false; code: 'LIMIT_REACHED'; message: string }
  | { ok: false; code: 'DUPLICATE_NAME'; message: string };

export type ConfigResult<T> = { ok: true; data: T } | ConfigFailure;

function invalid(message: string): ConfigFailure {
  return { ok: false, code: 'INVALID_INPUT', message };
}

/** Uniform refusal for "absent" and "not yours" — no id oracle. */
const NOT_FOUND: ConfigFailure = {
  ok: false,
  code: 'NOT_FOUND',
  message: 'No such record for this operator.',
};

function isDuplicateNameError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('owner_name_idx') || message.includes('duplicate key');
}

function validateMetricKeys(keys: unknown): { ok: true; keys: string[] } | ConfigFailure {
  if (!Array.isArray(keys) || keys.length === 0) {
    return invalid('metricKeys must be a non-empty array of catalogue metric keys.');
  }
  if (keys.length > 40) return invalid('A saved view may reference at most 40 metrics.');
  const unknown = keys.filter((key) => typeof key !== 'string' || !getMetricDefinition(key));
  if (unknown.length > 0) {
    return invalid(`Unknown metric key(s): ${unknown.slice(0, 5).join(', ')}.`);
  }
  return { ok: true, keys: keys as string[] };
}

function validateWindow(input: { periodDays?: number | null; startDay?: string | null; endDay?: string | null }): ConfigFailure | null {
  const hasExplicit = Boolean(input.startDay && input.endDay);
  if (!hasExplicit && (input.periodDays === undefined || input.periodDays === null)) {
    return invalid('Provide either periodDays or both startDay and endDay.');
  }
  if (input.periodDays !== undefined && input.periodDays !== null) {
    if (!Number.isInteger(input.periodDays) || input.periodDays < 1 || input.periodDays > 366) {
      return invalid('periodDays must be an integer between 1 and 366.');
    }
  }
  if (hasExplicit) {
    try {
      resolveKampalaPeriod({ startDate: input.startDay, endDate: input.endDay });
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'Invalid window.');
    }
  }
  return null;
}

export class ManageAnalyticsSavedViewsUseCase {
  constructor(private readonly repo: IAnalyticsSavedViewRepository) {}

  list(ownerId: string, limit = 100): Promise<AnalyticsSavedView[]> {
    return this.repo.listVisibleTo(ownerId, limit);
  }

  async get(id: string, ownerId: string): Promise<ConfigResult<AnalyticsSavedView>> {
    const view = await this.repo.findVisible(id, ownerId);
    return view ? { ok: true, data: view } : NOT_FOUND;
  }

  async create(input: {
    ownerId: string;
    name?: unknown;
    description?: unknown;
    scope?: unknown;
    periodDays?: number | null;
    startDay?: string | null;
    endDay?: string | null;
    metricKeys?: unknown;
    filters?: Record<string, unknown>;
  }): Promise<ConfigResult<AnalyticsSavedView>> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > 120) return invalid('name must be 1-120 characters.');
    const scope: SavedViewScope = input.scope === 'SHARED' ? 'SHARED' : 'PRIVATE';
    const metrics = validateMetricKeys(input.metricKeys);
    if (!('ok' in metrics) || metrics.ok !== true) return metrics as ConfigFailure;
    const windowError = validateWindow(input);
    if (windowError) return windowError;

    if (await this.repo.countOwnedBy(input.ownerId) >= MAX_SAVED_VIEWS_PER_OWNER) {
      return { ok: false, code: 'LIMIT_REACHED', message: `An operator may keep at most ${MAX_SAVED_VIEWS_PER_OWNER} saved views.` };
    }

    try {
      const view = await this.repo.create({
        ownerId: input.ownerId,
        name,
        description: typeof input.description === 'string' ? input.description.slice(0, 500) : null,
        scope,
        periodDays: input.periodDays ?? null,
        startDay: input.startDay ?? null,
        endDay: input.endDay ?? null,
        metricKeys: metrics.keys,
        filters: input.filters ?? {},
      });
      return { ok: true, data: view };
    } catch (error) {
      if (isDuplicateNameError(error)) {
        return { ok: false, code: 'DUPLICATE_NAME', message: 'You already have a saved view with that name.' };
      }
      throw error;
    }
  }

  async update(id: string, ownerId: string, patch: Record<string, unknown>): Promise<ConfigResult<AnalyticsSavedView>> {
    const changes: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : '';
      if (name.length < 1 || name.length > 120) return invalid('name must be 1-120 characters.');
      changes.name = name;
    }
    if (patch.description !== undefined) {
      changes.description = typeof patch.description === 'string' ? patch.description.slice(0, 500) : null;
    }
    if (patch.scope !== undefined) {
      if (patch.scope !== 'PRIVATE' && patch.scope !== 'SHARED') return invalid('scope must be PRIVATE or SHARED.');
      changes.scope = patch.scope;
    }
    if (patch.metricKeys !== undefined) {
      const metrics = validateMetricKeys(patch.metricKeys);
      if (!('ok' in metrics) || metrics.ok !== true) return metrics as ConfigFailure;
      changes.metricKeys = metrics.keys;
    }
    if (patch.periodDays !== undefined || patch.startDay !== undefined || patch.endDay !== undefined) {
      const windowError = validateWindow({
        periodDays: patch.periodDays as number | null | undefined,
        startDay: patch.startDay as string | null | undefined,
        endDay: patch.endDay as string | null | undefined,
      });
      if (windowError) return windowError;
      if (patch.periodDays !== undefined) changes.periodDays = patch.periodDays;
      if (patch.startDay !== undefined) changes.startDay = patch.startDay;
      if (patch.endDay !== undefined) changes.endDay = patch.endDay;
    }
    if (patch.filters !== undefined) changes.filters = patch.filters as Record<string, unknown>;
    if (Object.keys(changes).length === 0) return invalid('No supported fields were provided.');

    try {
      const view = await this.repo.updateOwned(id, ownerId, changes);
      return view ? { ok: true, data: view } : NOT_FOUND;
    } catch (error) {
      if (isDuplicateNameError(error)) {
        return { ok: false, code: 'DUPLICATE_NAME', message: 'You already have a saved view with that name.' };
      }
      throw error;
    }
  }

  async remove(id: string, ownerId: string): Promise<ConfigResult<{ id: string }>> {
    const deleted = await this.repo.deleteOwned(id, ownerId);
    return deleted ? { ok: true, data: { id } } : NOT_FOUND;
  }
}

const COMPARISONS: AlertComparison[] = ['ABOVE', 'BELOW'];
const SEVERITIES: AlertSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export class ManageAnalyticsAlertRulesUseCase {
  constructor(private readonly repo: IAnalyticsAlertRuleRepository) {}

  list(ownerId: string, limit = 100): Promise<AnalyticsAlertRule[]> {
    return this.repo.listOwnedBy(ownerId, limit);
  }

  async create(input: {
    ownerId: string;
    name?: unknown;
    metricKey?: unknown;
    comparison?: unknown;
    threshold?: unknown;
    minimumSample?: unknown;
    evaluationDays?: unknown;
    severity?: unknown;
    cooldownMinutes?: unknown;
  }): Promise<ConfigResult<AnalyticsAlertRule>> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > 120) return invalid('name must be 1-120 characters.');

    const metricKey = typeof input.metricKey === 'string' ? input.metricKey : '';
    const definition = getMetricDefinition(metricKey);
    if (!definition) return invalid(`Unknown metric key '${metricKey}'.`);

    const comparison = input.comparison as AlertComparison;
    if (!COMPARISONS.includes(comparison)) return invalid('comparison must be ABOVE or BELOW.');

    const threshold = Number(input.threshold);
    if (!Number.isFinite(threshold)) return invalid('threshold must be a finite number.');
    if (definition.unit === 'rate' && (threshold < 0 || threshold > 1)) {
      return invalid('A rate threshold must be between 0 and 1.');
    }

    // The rule's floor may be stricter than the catalogue's, never weaker: an
    // operator must not be able to configure their way under the volume floor
    // that keeps low-count noise out of the Action Centre.
    const requested = Number(input.minimumSample ?? definition.minimumSample);
    if (!Number.isInteger(requested) || requested < 1) return invalid('minimumSample must be a positive integer.');
    const minimumSample = Math.max(requested, definition.minimumSample || 1);

    const evaluationDays = Number(input.evaluationDays ?? 7);
    if (!Number.isInteger(evaluationDays) || evaluationDays < 1 || evaluationDays > 366) {
      return invalid('evaluationDays must be an integer between 1 and 366.');
    }

    const severity = (input.severity ?? 'MEDIUM') as AlertSeverity;
    if (!SEVERITIES.includes(severity)) return invalid('severity must be CRITICAL, HIGH, MEDIUM or LOW.');

    const cooldownMinutes = Number(input.cooldownMinutes ?? 720);
    if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0) return invalid('cooldownMinutes must be a non-negative integer.');

    if (await this.repo.countOwnedBy(input.ownerId) >= MAX_ALERT_RULES_PER_OWNER) {
      return { ok: false, code: 'LIMIT_REACHED', message: `An operator may keep at most ${MAX_ALERT_RULES_PER_OWNER} alert rules.` };
    }

    try {
      const rule = await this.repo.create({
        ownerId: input.ownerId,
        name,
        metricKey,
        comparison,
        threshold,
        minimumSample,
        evaluationDays,
        severity,
        cooldownMinutes,
      });
      return { ok: true, data: rule };
    } catch (error) {
      if (isDuplicateNameError(error)) {
        return { ok: false, code: 'DUPLICATE_NAME', message: 'You already have an alert rule with that name.' };
      }
      throw error;
    }
  }

  async update(id: string, ownerId: string, patch: Record<string, unknown>): Promise<ConfigResult<AnalyticsAlertRule>> {
    const existing = await this.repo.findOwned(id, ownerId);
    if (!existing) return NOT_FOUND;
    const definition = requireMetricDefinition(existing.metricKey);

    const changes: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : '';
      if (name.length < 1 || name.length > 120) return invalid('name must be 1-120 characters.');
      changes.name = name;
    }
    if (patch.comparison !== undefined) {
      if (!COMPARISONS.includes(patch.comparison as AlertComparison)) return invalid('comparison must be ABOVE or BELOW.');
      changes.comparison = patch.comparison;
    }
    if (patch.threshold !== undefined) {
      const threshold = Number(patch.threshold);
      if (!Number.isFinite(threshold)) return invalid('threshold must be a finite number.');
      if (definition.unit === 'rate' && (threshold < 0 || threshold > 1)) return invalid('A rate threshold must be between 0 and 1.');
      changes.threshold = threshold;
    }
    if (patch.minimumSample !== undefined) {
      const requested = Number(patch.minimumSample);
      if (!Number.isInteger(requested) || requested < 1) return invalid('minimumSample must be a positive integer.');
      changes.minimumSample = Math.max(requested, definition.minimumSample || 1);
    }
    if (patch.evaluationDays !== undefined) {
      const days = Number(patch.evaluationDays);
      if (!Number.isInteger(days) || days < 1 || days > 366) return invalid('evaluationDays must be an integer between 1 and 366.');
      changes.evaluationDays = days;
    }
    if (patch.severity !== undefined) {
      if (!SEVERITIES.includes(patch.severity as AlertSeverity)) return invalid('severity must be CRITICAL, HIGH, MEDIUM or LOW.');
      changes.severity = patch.severity;
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') return invalid('enabled must be a boolean.');
      changes.enabled = patch.enabled;
    }
    if (patch.cooldownMinutes !== undefined) {
      const cooldown = Number(patch.cooldownMinutes);
      if (!Number.isInteger(cooldown) || cooldown < 0) return invalid('cooldownMinutes must be a non-negative integer.');
      changes.cooldownMinutes = cooldown;
    }
    if (Object.keys(changes).length === 0) return invalid('No supported fields were provided.');

    const rule = await this.repo.updateOwned(id, ownerId, changes);
    return rule ? { ok: true, data: rule } : NOT_FOUND;
  }

  async remove(id: string, ownerId: string): Promise<ConfigResult<{ id: string }>> {
    const deleted = await this.repo.deleteOwned(id, ownerId);
    return deleted ? { ok: true, data: { id } } : NOT_FOUND;
  }
}

export interface AlertEvaluationOutcome {
  ruleId: string;
  ruleName: string;
  metricKey: string;
  fired: boolean;
  /** Why it did or did not fire — never a bare boolean. */
  reason:
    | 'FIRED'
    | 'WITHIN_THRESHOLD'
    | 'INSUFFICIENT_SAMPLE'
    | 'NO_VALUE'
    | 'IN_COOLDOWN';
  observedValue: number | null;
  sampleSize: number | null;
  action: AnalyticsActionItem | null;
}

/**
 * Evaluates enabled alert rules against the analytics overview and returns
 * internal actions. It sends nothing: the outcome is an in-process list the
 * Action Centre renders, and `recordEvaluation` only stamps timestamps.
 */
export class EvaluateAnalyticsAlertRulesUseCase {
  constructor(
    private readonly repo: IAnalyticsAlertRuleRepository,
    private readonly overview: GetAnalyticsOverviewUseCase,
  ) {}

  async execute(now: Date = new Date()): Promise<{ evaluatedAt: string; outcomes: AlertEvaluationOutcome[] }> {
    const rules = await this.repo.listEnabled(200);
    const outcomes: AlertEvaluationOutcome[] = [];

    // One overview per distinct evaluation window, not one per rule.
    const byWindow = new Map<number, Awaited<ReturnType<GetAnalyticsOverviewUseCase['execute']>>>();
    for (const rule of rules) {
      if (!byWindow.has(rule.evaluationDays)) {
        byWindow.set(rule.evaluationDays, await this.overview.execute({ days: rule.evaluationDays, now }));
      }
      const overview = byWindow.get(rule.evaluationDays)!;
      const metric = overview.metrics.find((m) => m.key === rule.metricKey);

      const inCooldown = rule.lastFiredAt !== null
        && now.getTime() - rule.lastFiredAt.getTime() < rule.cooldownMinutes * 60_000;

      let reason: AlertEvaluationOutcome['reason'];
      let fired = false;

      if (!metric || metric.value === null || !VALUE_BEARING_STATES.has(metric.state)) {
        reason = 'NO_VALUE';
      } else if ((metric.sampleSize ?? 0) < rule.minimumSample) {
        reason = 'INSUFFICIENT_SAMPLE';
      } else {
        const breached = rule.comparison === 'ABOVE'
          ? metric.value > rule.threshold
          : metric.value < rule.threshold;
        if (!breached) reason = 'WITHIN_THRESHOLD';
        else if (inCooldown) reason = 'IN_COOLDOWN';
        else { reason = 'FIRED'; fired = true; }
      }

      const definition = requireMetricDefinition(rule.metricKey);
      outcomes.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metricKey: rule.metricKey,
        fired,
        reason,
        observedValue: metric?.value ?? null,
        sampleSize: metric?.sampleSize ?? null,
        action: fired
          ? {
              id: `alert_rule:${rule.id}`,
              source: definition.source,
              severity: rule.severity,
              title: `${definition.label} ${rule.comparison === 'ABOVE' ? 'above' : 'below'} the configured threshold`,
              reason: `Alert rule "${rule.name}" watches ${definition.label} over the last ${rule.evaluationDays} Kampala day(s).`,
              evidence: `Observed ${metric!.value} against a threshold of ${rule.threshold} (n = ${metric!.sampleSize ?? 'n/a'}, minimum ${rule.minimumSample}).`,
              sampleSize: metric!.sampleSize ?? null,
              recommendedAction: `Investigate ${definition.label} using its drilldown, then acknowledge or adjust the rule.`,
              requiredPermission: 'analytics.read',
              drilldownRoute: definition.drilldownRoute,
              priority: rule.severity === 'CRITICAL' ? 98 : rule.severity === 'HIGH' ? 92 : rule.severity === 'MEDIUM' ? 80 : 60,
            }
          : null,
      });

      await this.repo.recordEvaluation(rule.id, now, fired);
    }

    return { evaluatedAt: now.toISOString(), outcomes };
  }
}

export interface AnalyticsExport {
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION;
  exportedAt: string;
  exportedBy: string;
  timezone: string;
  period: { startDay: string; endDay: string; days: number };
  filters: Record<string, unknown>;
  definitions: { key: string; label: string; definition: string; formula: string; unit: string; polarity: string }[];
  qualityWarnings: string[];
  rowCount: number;
  /** CSV text. Aggregates only — no customer or order identifiers. */
  csv: string;
}

/**
 * Bounded, audited analytics export.
 *
 * Exports the daily aggregate series and the metric definitions behind it.
 * There is deliberately no row-level export path: the underlying analytics
 * queries return aggregates only, so no export can carry customer data, and
 * nothing here writes to an external destination.
 */
export class ExportAnalyticsUseCase {
  constructor(private readonly overview: GetAnalyticsOverviewUseCase) {}

  async execute(input: {
    exportedBy: string;
    startDate?: string | null;
    endDate?: string | null;
    days?: number | null;
  }): Promise<ConfigResult<AnalyticsExport>> {
    let overview;
    try {
      overview = await this.overview.execute(input);
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'Invalid period.');
    }

    if (overview.trend.length > MAX_EXPORT_ROWS) {
      return invalid(`An export may contain at most ${MAX_EXPORT_ROWS} rows.`);
    }

    const header = 'kampala_day,orders,paid_orders,paid_order_value_ugx';
    const lines = overview.trend.map((point) =>
      `${point.day},${point.orders},${point.paidOrders},${point.paidOrderValueUgx}`);

    return {
      ok: true,
      data: {
        contractVersion: ANALYTICS_CONTRACT_VERSION,
        exportedAt: overview.generatedAt,
        exportedBy: input.exportedBy,
        timezone: ANALYTICS_TIMEZONE,
        period: {
          startDay: overview.period.startDay,
          endDay: overview.period.endDay,
          days: overview.period.days,
        },
        filters: {},
        definitions: overview.metrics.map((metric) => ({
          key: metric.key,
          label: metric.label,
          definition: metric.definition,
          formula: requireMetricDefinition(metric.key).formula,
          unit: metric.unit,
          polarity: metric.polarity,
        })),
        qualityWarnings: overview.quality.warnings,
        rowCount: overview.trend.length,
        csv: [header, ...lines].join('\n'),
      },
    };
  }
}
