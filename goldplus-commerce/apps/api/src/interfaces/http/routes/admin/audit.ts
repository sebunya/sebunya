import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ListAuditLogsUseCase, AuditLogListItem, isAuditActorId } from '../../../../application/use-cases/admin/ListAuditLogsUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

type AdminContextVars = {
  user: { id: string; email: string; permissions: string[] };
};

const routes = new Hono<{ Variables: AdminContextVars }>();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.AUDIT_READ]), async (c) => {
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const q = (k: string) => { const v = c.req.query(k)?.trim(); return v ? v.slice(0, 120) : undefined; };
  const actorFilter = q('actorId');
  if (actorFilter && !isAuditActorId(actorFilter)) {
    return c.json({ success: false, error: { code: 'BAD_ACTOR_ID', message: 'Actor id must be the full 36-character id. The table shows the first 8 characters — click one to filter by it.' } }, 400);
  }
  const uc = new ListAuditLogsUseCase(Registry.getInstance().auditRepo);
  const data = await uc.execute({
    limit: Number.isFinite(limit) ? (limit as number) : undefined,
    entity: q('entity'), entityId: q('entityId'), actorId: q('actorId'), action: q('action'),
  });

  const res: ApiResponse<AuditLogListItem[]> = { success: true, data };
  return c.json(res);
});

export default routes;
