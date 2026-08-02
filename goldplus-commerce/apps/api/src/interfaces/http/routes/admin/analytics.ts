import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS, ANALYTICS_METRIC_CATALOGUE } from '@goldplus/shared';

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

export default routes;
