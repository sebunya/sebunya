import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Product cost entry (production closure, 2026-08-07).
 *
 * `product_prices.cost_price` had no writer anywhere, so the commercial report
 * told operators to "enter costs to activate" profit with nowhere to enter
 * them. This is that surface.
 *
 * Supplier cost is secured data (CLAUDE.md): every route here demands its own
 * permission and nothing about cost is ever served to a public endpoint.
 *
 * The import is all-or-nothing with per-row errors, and `dryRun` returns the
 * exact same plan without writing — an operator can see what a file does
 * before it does it.
 */
const routes = new Hono();

routes.use('*', authMiddleware);

const MAX_ROWS = 5_000;

const parseRows = (body: any): Array<{ identifier: string; costPriceUgx: unknown; effectiveFrom: unknown; currency?: unknown; note?: unknown }> => {
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  return raw.slice(0, MAX_ROWS).map((row: any) => ({
    identifier: String(row?.identifier ?? row?.sku ?? row?.productId ?? '').trim(),
    costPriceUgx: row?.costPriceUgx ?? row?.cost ?? row?.costPrice,
    effectiveFrom: row?.effectiveFrom ?? row?.effective_from,
    currency: row?.currency,
    note: row?.note,
  }));
};

/** Which active products carry a cost and which do not — the gap, first. */
routes.get('/coverage', requirePermissions([PERMISSIONS.PRODUCT_COSTS_READ]), async (c) => {
  const limit = Math.min(1_000, Math.max(1, Number(c.req.query('limit')) || 200));
  const coverage = await Registry.getInstance().productCostRepo.getCoverage(limit);
  return c.json({ success: true, data: coverage });
});

/** Full cost history for one product, corrections and superseded rows included. */
routes.get('/:productId/entries', requirePermissions([PERMISSIONS.PRODUCT_COSTS_READ]), async (c) => {
  const entries = await Registry.getInstance().productCostRepo.listEntriesForProduct(String(c.req.param('productId')));
  return c.json({ success: true, data: { entries } });
});

/**
 * Validate a whole file and report what it WOULD do. Writes nothing, ever.
 */
routes.post('/import/preview', requirePermissions([PERMISSIONS.PRODUCT_COSTS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'Invalid body' } }, 400);

  const result = await Registry.getInstance().productCostRepo.importCosts({
    rows: parseRows(body),
    source: String(body.source ?? 'admin-preview').slice(0, 120),
    enteredBy: (c.get('user') as { id: string }).id,
    dryRun: true,
  });
  return c.json({ success: true, data: result });
});

/**
 * Commit a file. Every row validates or nothing is written; the response
 * carries per-row errors so the operator can fix and resubmit.
 */
routes.post('/import', requirePermissions([PERMISSIONS.PRODUCT_COSTS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'Invalid body' } }, 400);

  const rows = parseRows(body);
  const source = String(body.source ?? 'admin-import').slice(0, 120);
  const actorId = (c.get('user') as { id: string }).id;

  const result = await Registry.getInstance().productCostRepo.importCosts({ rows, source, enteredBy: actorId, dryRun: false });

  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId,
    action: result.accepted ? 'PRODUCT_COSTS_IMPORTED' : 'PRODUCT_COSTS_IMPORT_REJECTED',
    entity: 'product_cost_entries',
    entityId: source,
    previousState: null,
    newState: {
      source,
      totalRows: result.totalRows,
      applied: result.applied,
      corrections: result.plan.filter((p) => p.isCorrection).length,
      errorCount: result.errors.length,
      // The first few reasons, so the audit says WHY a file was refused
      // without copying a five-thousand-row file into the log.
      firstErrors: result.errors.slice(0, 5),
      products: result.plan.slice(0, 50).map((p) => ({ productId: p.productId, sku: p.sku, costPriceUgx: p.costPriceUgx, effectiveFrom: p.effectiveFrom })),
    },
  });

  return c.json({ success: result.accepted, data: result }, result.accepted ? 200 : 422);
});

export default routes;
