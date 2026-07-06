import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();

routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.DASHBOARD_READ]), async (c) => {
  const daysRaw = c.req.query('days');
  const days = daysRaw ? parseInt(daysRaw, 10) : 7;

  const data = await Registry.getInstance().getAdminDashboardUseCase.execute({
    days: Number.isNaN(days) ? 7 : days,
  });

  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

export default routes;
