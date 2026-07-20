import { Hono } from 'hono'; import { z } from 'zod'; import { PERMISSIONS } from '@goldplus/shared'; import { Registry } from '../../../../infrastructure/Registry'; import { authMiddleware } from '../../middleware/auth'; import { requirePermissions } from '../../middleware/permissions';
const routes = new Hono(); routes.use('*', authMiddleware); const query = z.object({ approvalStatus: z.enum(['draft','approved','rejected']).optional(), active: z.enum(['true','false']).transform((value) => value === 'true').optional() });
const report = async (c: any) => { const parsed = query.safeParse(c.req.query()); if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_FILTER', message: parsed.error.issues[0]?.message ?? 'Invalid filter.' } }, 400); return c.json({ success: true, data: await Registry.getInstance().getCopyQualityReportUseCase.execute(parsed.data) }); };
routes.get('/', requirePermissions([PERMISSIONS.COPY_QUALITY_READ], 'PERMISSION_DENIED'), report);
routes.get('/export', requirePermissions([PERMISSIONS.COPY_QUALITY_EXPORT], 'PERMISSION_DENIED'), report);
export default routes;
