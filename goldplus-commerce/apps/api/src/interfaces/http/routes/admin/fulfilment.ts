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
 * audit-exempt: every write endpoint (status/assign/priority/claim/team move,
 * team + membership CRUD, bulk assign) delegates auditing to its use case, each
 * of which writes the audit timeline via CreateAuditLogUseCase — a dedicated
 * audit channel.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const listQuerySchema = z.object({
  status: z.enum(FULFILMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  activeOnly: z.enum(['true', 'false']).optional(),
  assignedTo: z.string().min(1).max(64).optional(),
  teamId: z.string().min(1).max(64).optional(),
  scope: z.enum(['my', 'unassigned', 'team', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

routes.get('/', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    activeOnly: c.req.query('activeOnly'),
    assignedTo: c.req.query('assignedTo'),
    teamId: c.req.query('teamId'),
    scope: c.req.query('scope'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' } } satisfies ApiResponse<never>,
      400
    );
  }
  // Queue scopes (my / unassigned / team / all) resolve to concrete filters.
  const actorId = (c.get('user') as any).id as string;
  let assignedTo: string | 'unassigned' | null = parsed.data.assignedTo ?? null;
  let teamId: string | 'unassigned' | null = parsed.data.teamId ?? null;
  if (parsed.data.scope === 'my') assignedTo = actorId;
  else if (parsed.data.scope === 'unassigned') assignedTo = 'unassigned';
  else if (parsed.data.scope === 'team') teamId = parsed.data.teamId ?? 'unassigned';
  const result = await Registry.getInstance().listFulfilmentQueueUseCase.execute({
    status: parsed.data.status ?? null,
    activeOnly: parsed.data.activeOnly === 'true',
    assignedTo,
    teamId,
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

// F5 report — registered before '/:id' so the static path is not shadowed.
routes.get('/report', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const report = await Registry.getInstance().getFulfilmentReportUseCase.execute();
  return c.json({ success: true, data: report } satisfies ApiResponse<typeof report>);
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

// --- F1: teams, membership, ownership (orders.manage; audited in use cases) ---

routes.get('/teams', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const teams = await Registry.getInstance().listFulfilmentTeamsUseCase.execute();
  return c.json({ success: true, data: teams } satisfies ApiResponse<typeof teams>);
});

routes.post('/teams', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ name: z.string().trim().min(2).max(120) }).safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().createFulfilmentTeamUseCase.execute({ name: parsed.data.name, actorId });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  return c.json({ success: true, data: result.team } satisfies ApiResponse<typeof result.team>);
});

const memberBody = z.object({ userId: z.string().uuid(), action: z.enum(['add', 'remove']) });
routes.post('/teams/:teamId/members', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const teamId = String(c.req.param('teamId') ?? '');
  const parsed = memberBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().manageTeamMemberUseCase.execute({ teamId, userId: parsed.data.userId, action: parsed.data.action, actorId });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data: { ok: true } } satisfies ApiResponse<{ ok: boolean }>);
});

routes.patch('/:id/claim', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().assignFulfilmentTaskUseCase.execute({ taskId: id, assignedTo: actorId, actorId });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const teamMoveBody = z.object({ teamId: z.string().uuid().nullable() });
routes.patch('/:id/team', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = teamMoveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().moveFulfilmentTeamUseCase.execute({ taskId: id, teamId: parsed.data.teamId, actorId });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' || result.code === 'TEAM_NOT_FOUND' ? 404 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const bulkBody = z.object({ taskIds: z.array(z.string().uuid()).min(1).max(100), assignedTo: z.string().uuid().nullable() });
routes.post('/bulk-assign', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const parsed = bulkBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().bulkAssignFulfilmentTasksUseCase.execute({ taskIds: parsed.data.taskIds, assignedTo: parsed.data.assignedTo, actorId });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

// --- F3: packing, partial fulfilment and backorders ---

function packingErrStatus(code: string): 400 | 404 | 409 {
  if (code === 'NOT_FOUND' || code === 'UNKNOWN_LINE') return 404;
  if (code === 'STALE_FULFILMENT_VERSION') return 409;
  return 400;
}

routes.get('/:id/packing', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const reg = Registry.getInstance();
  await reg.initialiseFulfilmentLinesUseCase.execute(id); // idempotent lazy init
  const result = await reg.getPackingDetailUseCase.execute(id);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, packingErrStatus(result.code));
  return c.json({ success: true, data: result.detail } satisfies ApiResponse<typeof result.detail>);
});

routes.post('/:id/packing/start', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const reg = Registry.getInstance();
  await reg.initialiseFulfilmentLinesUseCase.execute(id);
  const actorId = (c.get('user') as any).id as string;
  const result = await reg.startPackingUseCase.execute({ taskId: id, actorId });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, packingErrStatus(result.code));
  return c.json({ success: true, data: result.session } satisfies ApiResponse<typeof result.session>);
});

const packedBody = z.object({
  updates: z.array(z.object({ lineId: z.string().uuid(), packed: z.number().int().min(0), expectedVersion: z.number().int().min(0) })).min(1).max(200),
});
routes.patch('/:id/packing/packed', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = packedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUANTITY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().updatePackedQuantitiesUseCase.execute({ taskId: id, actorId, updates: parsed.data.updates });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, packingErrStatus(result.code));
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const remainderBody = z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(1), expectedVersion: z.number().int().min(0), reason: z.string().trim().max(500).optional() });
routes.post('/:id/packing/backorder', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = remainderBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUANTITY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().resolveRemainderUseCase.execute({ taskId: id, actorId, action: 'backorder', ...parsed.data });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, packingErrStatus(result.code));
  return c.json({ success: true, data: { ok: true } } satisfies ApiResponse<{ ok: boolean }>);
});
routes.post('/:id/packing/cancel-remainder', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = remainderBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUANTITY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().resolveRemainderUseCase.execute({ taskId: id, actorId, action: 'cancel', ...parsed.data });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, packingErrStatus(result.code));
  return c.json({ success: true, data: { ok: true } } satisfies ApiResponse<{ ok: boolean }>);
});

const completeBody = z.object({ packageCount: z.number().int().min(0).optional(), packageReference: z.string().trim().max(120).optional(), notes: z.string().trim().max(2000).optional() });
routes.post('/:id/packing/complete', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = completeBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUANTITY', message: 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().completePackingUseCase.execute({ taskId: id, actorId, ...parsed.data });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, packingErrStatus(result.code));
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const exceptionBody = z.object({ reason: z.string().trim().min(1).max(500), hold: z.boolean().optional() });
routes.post('/:id/packing/exception', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = exceptionBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUANTITY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().recordPackingExceptionUseCase.execute({ taskId: id, actorId, ...parsed.data });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, packingErrStatus(result.code));
  return c.json({ success: true, data: { ok: true } } satisfies ApiResponse<{ ok: boolean }>);
});

// --- F4: dispatch tracking (stock consumed once at READY_FOR_DISPATCH) ---

function dispatchErrStatus(code: string): 400 | 404 | 409 {
  if (code === 'NOT_FOUND' || code === 'NO_DISPATCH') return 404;
  if (code === 'STALE_DISPATCH_VERSION' || code === 'VARIANCE_AGREEMENT_PENDING') return 409;
  return 400;
}

routes.get('/:id/dispatch', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const result = await Registry.getInstance().getDispatchUseCase.execute(id);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, dispatchErrStatus(result.code));
  return c.json({ success: true, data: { dispatch: result.dispatch, status: result.status } } satisfies ApiResponse<{ dispatch: typeof result.dispatch; status: string }>);
});

const recordDispatchBody = z.object({
  method: z.enum(['RIDER', 'COURIER', 'PICKUP', 'THIRD_PARTY']),
  carrierName: z.string().trim().max(120).optional(),
  riderName: z.string().trim().max(120).optional(),
  contact: z.string().trim().max(40).optional(),
  estimatedDeliveryAt: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  allowCashOnDelivery: z.boolean().optional(),
});
routes.post('/:id/dispatch', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = recordDispatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().recordDispatchUseCase.execute({
    taskId: id,
    actorId,
    method: parsed.data.method,
    carrierName: parsed.data.carrierName,
    riderName: parsed.data.riderName,
    contact: parsed.data.contact,
    estimatedDeliveryAt: parsed.data.estimatedDeliveryAt ? new Date(parsed.data.estimatedDeliveryAt) : null,
    notes: parsed.data.notes,
    allowCashOnDelivery: parsed.data.allowCashOnDelivery,
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, dispatchErrStatus(result.code));
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const dispatchTrackingBody = z.object({
  expectedVersion: z.number().int().min(1),
  trackingStatus: z.enum(['DISPATCHED', 'IN_TRANSIT', 'HANDED_OVER']).optional(),
  estimatedDeliveryAt: z.string().datetime().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
routes.patch('/:id/dispatch/tracking', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = dispatchTrackingBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().updateDispatchTrackingUseCase.execute({
    taskId: id,
    actorId,
    expectedVersion: parsed.data.expectedVersion,
    trackingStatus: parsed.data.trackingStatus,
    estimatedDeliveryAt: parsed.data.estimatedDeliveryAt === undefined ? undefined : parsed.data.estimatedDeliveryAt ? new Date(parsed.data.estimatedDeliveryAt) : null,
    notes: parsed.data.notes === undefined ? undefined : parsed.data.notes,
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, dispatchErrStatus(result.code));
  return c.json({ success: true, data: result.dispatch } satisfies ApiResponse<typeof result.dispatch>);
});

// --- F5: delivery confirmation and reporting ---

function deliveryErrStatus(code: string): 400 | 404 {
  return code === 'NOT_FOUND' ? 404 : 400;
}

routes.get('/:id/delivery', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const result = await Registry.getInstance().getDeliveryHistoryUseCase.execute(id);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, deliveryErrStatus(result.code));
  return c.json({ success: true, data: { status: result.status, deliveries: result.deliveries } } satisfies ApiResponse<{ status: string; deliveries: typeof result.deliveries }>);
});

const recordDeliveryBody = z.object({
  outcome: z.enum(['DELIVERED', 'DELIVERY_FAILED', 'RESCHEDULED', 'RETURN_TO_ORIGIN', 'PARTIALLY_DELIVERED']),
  deliveredQuantity: z.number().int().min(0).optional(),
  returnedQuantity: z.number().int().min(0).optional(),
  recipientName: z.string().trim().max(120).optional(),
  recipientConfirmation: z.string().trim().max(120).optional(),
  proofReference: z.string().trim().max(120).optional(),
  failedReason: z.string().trim().max(500).optional(),
  rescheduledFor: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
});
routes.post('/:id/delivery', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const parsed = recordDeliveryBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUANTITY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().recordDeliveryUseCase.execute({
    taskId: id,
    actorId,
    outcome: parsed.data.outcome,
    deliveredQuantity: parsed.data.deliveredQuantity,
    returnedQuantity: parsed.data.returnedQuantity,
    recipientName: parsed.data.recipientName,
    recipientConfirmation: parsed.data.recipientConfirmation,
    proofReference: parsed.data.proofReference,
    failedReason: parsed.data.failedReason,
    rescheduledFor: parsed.data.rescheduledFor ? new Date(parsed.data.rescheduledFor) : null,
    notes: parsed.data.notes,
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, deliveryErrStatus(result.code));
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

// --- F2: SLA escalation (evaluate + summary) ---

routes.get('/sla/summary', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const summary = await Registry.getInstance().getFulfilmentOverviewUseCase.slaSummary();
  return c.json({ success: true, data: summary } satisfies ApiResponse<typeof summary>);
});

routes.post('/sla/evaluate', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().evaluateFulfilmentSlaBatchUseCase.execute({ actorId });
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

export default routes;
