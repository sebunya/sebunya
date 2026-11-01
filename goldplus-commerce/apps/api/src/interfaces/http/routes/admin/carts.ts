import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Cart operations admin surface (Wave 2E-1: abandonment visibility). Read-only —
 * classifications are written exclusively by the scheduled evaluator.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: any, data: T) => c.json({ success: true, data } satisfies ApiResponse<T>);

routes.get('/abandonment', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const [summary, recent] = await Promise.all([
    registry.abandonmentUseCase.summary(),
    registry.abandonmentUseCase.recent(Number(c.req.query('limit')) || 50),
  ]);
  return ok(c, { summary, recent });
});

export default routes;
