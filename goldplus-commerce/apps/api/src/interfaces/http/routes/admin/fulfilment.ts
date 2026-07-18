import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { FULFILMENT_STATUSES } from '../../../../domain/fulfilment/FulfilmentTask';

/**
 * Launch Phase 1 (Section 9.3) — admin fulfilment queue.
 *
 * Read surfaces require orders.read; the lifecycle transition requires
 * orders.manage and is audit-logged (timeline). Deny-by-default: every route is
 * behind authMiddleware + an explicit permission.
 *
 * audit-exempt: the only write endpoint (PATCH /:id/status) delegates auditing
 * to TransitionFulfilmentTaskUseCase, which writes the fulfilment_task audit
 * timeline via CreateAuditLogUseCase — a dedicated audit channel.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const listQuerySchema = z.object({
  status: z.enum(FULFILMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  activeOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

routes.get('/', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    activeOnly: c.req.query('activeOnly'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' } } satisfies ApiResponse<never>,
      400
    );
  }
  const result = await Registry.getInstance().listFulfilmentQueueUseCase.execute({
    status: parsed.data.status ?? null,
    activeOnly: parsed.data.activeOnly === 'true',
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

routes.get('/badge', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const badge = await Registry.getInstance().getFulfilmentOverviewUseCase.badge();
  const res: ApiResponse<typeof badge> = { success: true, data: badge };
  return c.json(res);
});

routes.get('/:id', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const task = await Registry.getInstance().getFulfilmentOverviewUseCase.byId(id);
  if (!task) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Fulfilment task not found.' } } satisfies ApiResponse<never>, 404);
  }
  const res: ApiResponse<typeof task> = { success: true, data: task };
  return c.json(res);
});

const transitionBodySchema = z.object({
  toStatus: z.enum(FULFILMENT_STATUSES as unknown as [string, ...string[]]),
  assignedTo: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

routes.patch('/:id/status', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const body = await c.req.json().catch(() => null);
  const parsed = transitionBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>,
      400
    );
  }
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().transitionFulfilmentTaskUseCase.execute({
    taskId: id,
    toStatus: parsed.data.toStatus,
    actorId,
    assignedTo: parsed.data.assignedTo ?? undefined,
    notes: parsed.data.notes ?? undefined,
  });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

export default routes;
