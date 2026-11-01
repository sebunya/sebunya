import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Inventory ledger read surfaces (Section 12). All behind inventory.read.
 * Availability and low-stock are derived truthfully from stock_quantity,
 * reserved_quantity and reorder_point — no invented stock figures.
 *
 * audit-exempt: read-only routes; the mutating stock movements (reserve /
 * release / consume) are driven by the checkout and fulfilment-transition flows
 * and audited there.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/low-stock', requirePermissions([PERMISSIONS.INVENTORY_READ]), async (c) => {
  const limit = Number(c.req.query('limit') ?? 100);
  const rows = await Registry.getInstance().listLowStockUseCase.execute(Number.isFinite(limit) ? limit : 100);
  const res: ApiResponse<typeof rows> = { success: true, data: rows };
  return c.json(res);
});

const availabilityQuery = z.object({
  productIds: z.string().min(1),
});

routes.get('/availability', requirePermissions([PERMISSIONS.INVENTORY_READ]), async (c) => {
  const parsed = availabilityQuery.safeParse({ productIds: c.req.query('productIds') });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_QUERY', message: 'productIds query (comma-separated) is required.' } } satisfies ApiResponse<never>,
      400
    );
  }
  const ids = parsed.data.productIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  const rows = await Registry.getInstance().getInventoryAvailabilityUseCase.execute(ids);
  const res: ApiResponse<typeof rows> = { success: true, data: rows };
  return c.json(res);
});

// Wave 2E-2 — the first governed WRITE on this surface. Row-locked set-or-delta,
// refused below zero or below reserved holds, audited with before/after.
routes.post('/adjust', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
  const mode = body?.mode === 'delta' ? 'delta' : body?.mode === 'set' ? 'set' : null;
  const value = Number(body?.value);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!productId || !mode || !Number.isFinite(value)) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'productId, mode (set|delta) and integer value are required.' } } satisfies ApiResponse<never>, 400);
  }
  if (!reason) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'A reason is required for every stock adjustment.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const outcome = await registry.adjustStockUseCase.execute({ productId, mode, value });
  if (!outcome.ok) {
    const status = outcome.code === 'NOT_FOUND' ? 404 : outcome.code === 'BAD_INPUT' ? 400 : 409;
    return c.json({ success: false, error: { code: outcome.code, message: outcome.message } } satisfies ApiResponse<never>, status);
  }
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as { id: string }).id,
    action: 'STOCK_ADJUSTED',
    entity: 'product',
    entityId: productId,
    previousState: { stockQuantity: outcome.adjustment.before },
    newState: { stockQuantity: outcome.adjustment.after, reserved: outcome.adjustment.reserved, mode, value, reason },
  });
  const res: ApiResponse<typeof outcome.adjustment> = { success: true, data: outcome.adjustment };
  return c.json(res);
});

export default routes;
