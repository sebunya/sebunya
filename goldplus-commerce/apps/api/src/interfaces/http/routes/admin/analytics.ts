import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();

routes.use('*', authMiddleware);

routes.get('/engagement', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const daysRaw = c.req.query('days');
  const days = daysRaw ? parseInt(daysRaw, 10) : 7;

  const summary = await Registry.getInstance().getEngagementSummaryUseCase.execute({
    days: Number.isNaN(days) ? 7 : days,
  });

  const res: ApiResponse<typeof summary> = { success: true, data: summary };
  return c.json(res);
});

export default routes;
