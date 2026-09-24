import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { logger } from '../../../infrastructure/logging/logger';

/**
 * Public bulk quote requests (docs/bulk-buying/DESIGN.md).
 *
 * Thin by design: parse JSON, call the use case, map the result. Rate limits
 * live in the abuse-control layer (POST /quotes/bulk is the `quote-request`
 * family, POST /quotes/lookup the `order-lookup` family).
 */
const routes = new Hono();
const registry = Registry.getInstance();

const MAX_BODY_BYTES = 64 * 1024;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

routes.post('/bulk', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } }, 400);

  const result = await registry.submitBulkQuoteUseCase.execute(body);
  if (!result.ok) {
    const status = result.code === 'IDEMPOTENCY_CONFLICT' ? 409 : result.code === 'PRODUCTS_UNAVAILABLE' ? 422 : 400;
    const details = result.code === 'PRODUCTS_UNAVAILABLE'
      ? { productIds: result.productIds }
      : 'field' in result && result.field ? { field: result.field } : undefined;
    return c.json({ success: false, error: { code: result.code, message: result.message, ...(details ? { details } : {}) } }, status);
  }

  if (!result.replayed) {
    await registry.createAuditLogUseCase
      .execute({
        actorId: null,
        action: 'QUOTE_REQUESTED',
        entity: 'quote',
        entityId: result.quoteId,
        newState: {
          source: 'bulk_builder',
          reference: result.request.reference,
          lineCount: result.request.totals.lineCount,
          totalUnits: result.request.totals.totalUnits,
        },
      })
      .catch((err: unknown) => logger.warn({ err }, '[Quotes] audit write failed for bulk request'));
  }

  return c.json(
    { success: true, data: { quoteId: result.quoteId, replayed: result.replayed, request: result.request } },
    result.replayed ? 200 : 201,
  );
});

routes.post('/lookup', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } }, 400);
  const result = await registry.lookupBulkQuoteUseCase.execute({ reference: body.reference, phone: body.phone });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } }, 404);
  return c.json({ success: true, data: result.request });
});

export default routes;
