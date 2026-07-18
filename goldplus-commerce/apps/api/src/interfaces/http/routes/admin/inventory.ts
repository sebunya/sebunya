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

export default routes;
