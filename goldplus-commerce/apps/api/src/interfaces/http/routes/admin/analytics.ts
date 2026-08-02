import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS, ANALYTICS_METRIC_CATALOGUE } from '@goldplus/shared';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * Commerce Analytics — the authoritative analytics computation surface.
 *
 * Every endpoint is read-only, permission-gated by analytics.read and returns
 * bounded aggregates only: no endpoint here can enumerate customer records,
 * and the web analytics page never needs the order ledger again.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const periodQuery = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),
});

function parsePeriod(c: { req: { query: (k: string) => string | undefined } }) {
  return periodQuery.safeParse({
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
    days: c.req.query('days'),
  });
}

const invalidQuery = (message: string): ApiResponse<never> => ({
  success: false,
  error: { code: 'INVALID_QUERY', message },
});

routes.get('/overview', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const parsed = parsePeriod(c);
  if (!parsed.success) {
    return c.json(invalidQuery('startDate/endDate must be YYYY-MM-DD and days must be 1-366.'), 400);
  }
  try {
    const data = await Registry.getInstance().getAnalyticsOverviewUseCase.execute(parsed.data);
    return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
  } catch (error) {
    if (error instanceof Error && (error.message === 'END_BEFORE_START' || error.message === 'PERIOD_TOO_LONG')) {
      return c.json(invalidQuery(error.message === 'END_BEFORE_START'
        ? 'The end date cannot be earlier than the start date.'
        : 'The requested period exceeds the 366-day maximum.'), 400);
    }
    throw error;
  }
});

routes.get('/metrics/:metricKey/series', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const parsed = parsePeriod(c);
  if (!parsed.success) {
    return c.json(invalidQuery('startDate/endDate must be YYYY-MM-DD and days must be 1-366.'), 400);
  }
  const metricKey = String(c.req.param('metricKey') ?? '');
  try {
    const result = await Registry.getInstance().getAnalyticsMetricSeriesUseCase.execute(metricKey, parsed.data);
    if (!result.ok) {
      return c.json(
        { success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>,
        result.code === 'UNKNOWN_METRIC' ? 404 : 400,
      );
    }
    return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>);
  } catch (error) {
    if (error instanceof Error && (error.message === 'END_BEFORE_START' || error.message === 'PERIOD_TOO_LONG')) {
      return c.json(invalidQuery('Invalid period.'), 400);
    }
    throw error;
  }
});

routes.get('/quality', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const data = await Registry.getInstance().getAnalyticsDataQualityUseCase.execute();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.get('/actions', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const parsed = parsePeriod(c);
  if (!parsed.success) {
    return c.json(invalidQuery('startDate/endDate must be YYYY-MM-DD and days must be 1-366.'), 400);
  }
  try {
    const overview = await Registry.getInstance().getAnalyticsOverviewUseCase.execute(parsed.data);
    const data = { generatedAt: overview.generatedAt, period: overview.period, actions: overview.actions };
    return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
  } catch (error) {
    if (error instanceof Error && (error.message === 'END_BEFORE_START' || error.message === 'PERIOD_TOO_LONG')) {
      return c.json(invalidQuery('Invalid period.'), 400);
    }
    throw error;
  }
});

routes.get('/catalogue', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  return c.json({ success: true, data: ANALYTICS_METRIC_CATALOGUE } satisfies ApiResponse<typeof ANALYTICS_METRIC_CATALOGUE>);
});

// ─── Saved views, alert rules and exports ────────────────────────────────────
//
// Reading configuration needs analytics.read; changing it needs a separate
// manage permission; exports need their own. Every mutation is audited with
// the actor, the entity and the new state — sharing a view and enabling an
// alert are both governance events an auditor must be able to reconstruct.

const actorId = (c: any) => String((c.get('user') as any)?.id ?? '');

function failureStatus(code: string): 400 | 404 | 409 {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'DUPLICATE_NAME' || code === 'LIMIT_REACHED') return 409;
  return 400;
}

async function readJson(c: any): Promise<Record<string, unknown> | null> {
  return c.req.json().catch(() => null);
}

routes.get('/saved-views', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const data = await Registry.getInstance().manageAnalyticsSavedViewsUseCase.list(actorId(c));
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/saved-views', requirePermissions([PERMISSIONS.ANALYTICS_MANAGE]), async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  const registry = Registry.getInstance();
  const result = await registry.manageAnalyticsSavedViewsUseCase.create({ ...body, ownerId: actorId(c) } as any);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, failureStatus(result.code));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actorId(c),
    action: 'ANALYTICS_SAVED_VIEW_CREATED',
    entity: 'analytics_saved_view',
    entityId: result.data.id,
    newState: { name: result.data.name, scope: result.data.scope, metricKeys: result.data.metricKeys },
  });
  return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>, 201);
});

routes.patch('/saved-views/:id', requirePermissions([PERMISSIONS.ANALYTICS_MANAGE]), async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  const registry = Registry.getInstance();
  const id = String(c.req.param('id') ?? '');
  const result = await registry.manageAnalyticsSavedViewsUseCase.update(id, actorId(c), body);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, failureStatus(result.code));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actorId(c),
    action: 'ANALYTICS_SAVED_VIEW_UPDATED',
    entity: 'analytics_saved_view',
    entityId: id,
    newState: { name: result.data.name, scope: result.data.scope, metricKeys: result.data.metricKeys },
  });
  return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>);
});

routes.delete('/saved-views/:id', requirePermissions([PERMISSIONS.ANALYTICS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const id = String(c.req.param('id') ?? '');
  const result = await registry.manageAnalyticsSavedViewsUseCase.remove(id, actorId(c));
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, failureStatus(result.code));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actorId(c),
    action: 'ANALYTICS_SAVED_VIEW_DELETED',
    entity: 'analytics_saved_view',
    entityId: id,
    newState: { deleted: true },
  });
  return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>);
});

routes.get('/alert-rules', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const data = await Registry.getInstance().manageAnalyticsAlertRulesUseCase.list(actorId(c));
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/alert-rules', requirePermissions([PERMISSIONS.ANALYTICS_ALERTS_MANAGE]), async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  const registry = Registry.getInstance();
  const result = await registry.manageAnalyticsAlertRulesUseCase.create({ ...body, ownerId: actorId(c) } as any);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, failureStatus(result.code));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actorId(c),
    action: 'ANALYTICS_ALERT_RULE_CREATED',
    entity: 'analytics_alert_rule',
    entityId: result.data.id,
    newState: { name: result.data.name, metricKey: result.data.metricKey, comparison: result.data.comparison, threshold: result.data.threshold, minimumSample: result.data.minimumSample },
  });
  return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>, 201);
});

routes.patch('/alert-rules/:id', requirePermissions([PERMISSIONS.ANALYTICS_ALERTS_MANAGE]), async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  const registry = Registry.getInstance();
  const id = String(c.req.param('id') ?? '');
  const result = await registry.manageAnalyticsAlertRulesUseCase.update(id, actorId(c), body);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, failureStatus(result.code));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actorId(c),
    action: 'ANALYTICS_ALERT_RULE_UPDATED',
    entity: 'analytics_alert_rule',
    entityId: id,
    newState: { name: result.data.name, enabled: result.data.enabled, threshold: result.data.threshold, minimumSample: result.data.minimumSample },
  });
  return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>);
});

routes.delete('/alert-rules/:id', requirePermissions([PERMISSIONS.ANALYTICS_ALERTS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const id = String(c.req.param('id') ?? '');
  const result = await registry.manageAnalyticsAlertRulesUseCase.remove(id, actorId(c));
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, failureStatus(result.code));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actorId(c),
    action: 'ANALYTICS_ALERT_RULE_DELETED',
    entity: 'analytics_alert_rule',
    entityId: id,
    newState: { deleted: true },
  });
  return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>);
});

// Evaluation is read-only and produces internal actions only. It sends nothing.
routes.get('/alert-rules/evaluations', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const data = await Registry.getInstance().evaluateAnalyticsAlertRulesUseCase.execute();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/exports', requirePermissions([PERMISSIONS.ANALYTICS_EXPORT]), async (c) => {
  const parsed = parsePeriod(c);
  if (!parsed.success) return c.json(invalidQuery('startDate/endDate must be YYYY-MM-DD and days must be 1-366.'), 400);
  const registry = Registry.getInstance();
  const result = await registry.exportAnalyticsUseCase.execute({ ...parsed.data, exportedBy: actorId(c) });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, failureStatus(result.code));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actorId(c),
    action: 'ANALYTICS_EXPORTED',
    entity: 'analytics_export',
    entityId: `${result.data.period.startDay}..${result.data.period.endDay}`,
    newState: { rowCount: result.data.rowCount, days: result.data.period.days, timezone: result.data.timezone },
  });
  return c.json({ success: true, data: result.data } satisfies ApiResponse<typeof result.data>);
});

export default routes;
