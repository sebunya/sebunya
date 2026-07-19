import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { FULFILMENT_STATUSES, FULFILMENT_PRIORITIES } from '../../../../domain/fulfilment/FulfilmentTask';

/**
 * Launch Phase 1 (Section 9.3) — admin fulfilment queue.
 *
 * Read surfaces require orders.read; the lifecycle transition requires
 * orders.manage and is audit-logged (timeline). Deny-by-default: every route is
 * behind authMiddleware + an explicit permission.
 *
 * audit-exempt: the write endpoints (PATCH /:id/status, /:id/assign,
 * /:id/priority) delegate auditing to their use cases (Transition/Assign/
 * SetPriority FulfilmentTaskUseCase), each of which writes the fulfilment_task
 * audit timeline via CreateAuditLogUseCase — a dedicated audit channel.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const listQuerySchema = z.object({
  status: z.enum(FULFILMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  activeOnly: z.enum(['true', 'false']).optional(),
  assignedTo: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

routes.get('/', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    activeOnly: c.req.query('activeOnly'),
    assignedTo: c.req.query('assignedTo'),
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
    assignedTo: parsed.data.assignedTo ?? null,
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

  // Section 12 inventory effects (idempotent, best-effort — never fail the
  // transition): deduct on-hand stock when the order is dispatched-ready, and
  // release held stock when the order is cancelled.
  try {
    const registry = Registry.getInstance();
    if (result.to === 'READY_FOR_DISPATCH') {
      await registry.consumeInventoryForOrderUseCase.execute(result.orderId);
    } else if (result.to === 'CANCELLED') {
      await registry.releaseInventoryForOrderUseCase.execute(result.orderId);
      // Transactional admin email (OrderCancelled). Idempotent per order.
      const cancelledOrder = await registry.orderRepo.findById(result.orderId);
      if (cancelledOrder) {
        await registry.enqueueAdminOrderEmailUseCase.execute({
          order: cancelledOrder,
          event: 'cancelled',
          stockConfirmed: false,
        });
      }
    }
  } catch (invErr: any) {
    console.error('[API_ERROR] Inventory/email effect after fulfilment transition failed:', invErr?.message);
  }

  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

const assignBodySchema = z.object({
  assignedTo: z.string().uuid().nullable(),
});

routes.patch('/:id/assign', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = assignBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>,
      400
    );
  }
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().assignFulfilmentTaskUseCase.execute({
    taskId: id,
    assignedTo: parsed.data.assignedTo,
    actorId,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const priorityBodySchema = z.object({
  priority: z.enum(FULFILMENT_PRIORITIES as unknown as [string, ...string[]]),
});

routes.patch('/:id/priority', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = priorityBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>,
      400
    );
  }
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().setFulfilmentPriorityUseCase.execute({
    taskId: id,
    priority: parsed.data.priority,
    actorId,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

export default routes;
