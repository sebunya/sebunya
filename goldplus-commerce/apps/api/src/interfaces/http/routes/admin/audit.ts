import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ListAuditLogsUseCase, AuditLogListItem } from '../../../../application/use-cases/admin/ListAuditLogsUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

type AdminContextVars = {
  user: { id: string; email: string; permissions: string[] };
};

const routes = new Hono<{ Variables: AdminContextVars }>();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.AUDIT_READ]), async (c) => {
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const uc = new ListAuditLogsUseCase(Registry.getInstance().auditRepo);
  const data = await uc.execute({ limit: Number.isFinite(limit) ? (limit as number) : undefined });

  const res: ApiResponse<AuditLogListItem[]> = { success: true, data };
  return c.json(res);
});

export default routes;
