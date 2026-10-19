import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { logger } from '../../../infrastructure/logging/logger';

/**
 * Public bulk requests (docs/bulk-buying/DESIGN.md).
 *
 * Thin by design: parse JSON, call the use case, map the result. Rate limits
 * live in the abuse-control layer (POST /quotes/bulk is the `quote-request`
 * family; /quotes/lookup and /quotes/bulk-terms `order-lookup`; the two
 * price-access steps `auth-recovery`, because one sends an SMS and the other
 * is a code-guessing surface).
 *
 * The bulk price per piece leaves this API in ONE place, /quotes/bulk-terms,
 * and only for a caller holding the token a verified phone earns (owner,
 * 2026-10-19). Everything else here is public facts.
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
    const status = result.code === 'IDEMPOTENCY_CONFLICT' ? 409 : result.code === 'PRODUCTS_UNAVAILABLE' || result.code === 'COUNT_TOO_LARGE' ? 422 : 400;
    const details = 'productIds' in result
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
          totalCartons: result.request.totals.totalCartons,
          totalUnits: result.request.totals.totalUnits,
          budgetUgx: result.request.budgetUgx,
          pricesShown: result.request.pricesShown,
        },
      })
      .catch((err: unknown) => logger.warn({ err }, '[Quotes] audit write failed for bulk request'));
  }

  return c.json(
    { success: true, data: { quoteId: result.quoteId, replayed: result.replayed, contactPhone: result.contactPhone, request: result.request } },
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

routes.post('/bulk-terms', async (c) => {
  const body = (await readJson(c.req.raw)) ?? {};
  const result = await registry.getBulkTermsUseCase.execute({ token: body.token });
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: result });
});

routes.post('/price-access/start', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } }, 400);
  const result = await registry.startBulkPriceAccessUseCase.execute({ phone: body.phone });
  c.header('Cache-Control', 'no-store');
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } }, result.code === 'TOO_MANY_CODES' ? 429 : 400);
  if (result.method === 'first_visit') {
    await registry.createAuditLogUseCase
      .execute({ actorId: null, action: 'BULK_PRICES_UNLOCKED', entity: 'bulk_price_access', entityId: 'bulk-prices', newState: { phone: result.maskedPhone, method: 'first_visit' } })
      .catch((err: unknown) => logger.warn({ err }, '[Quotes] audit write failed for bulk price access'));
    return c.json({ success: true, data: { method: result.method, maskedPhone: result.maskedPhone, token: result.token, expiresAt: result.expiresAt.toISOString() } });
  }
  return c.json({ success: true, data: { method: result.method, maskedPhone: result.maskedPhone } });
});

routes.post('/price-access/verify', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } }, 400);
  const result = await registry.verifyBulkPriceAccessUseCase.execute({ phone: body.phone, code: body.code });
  c.header('Cache-Control', 'no-store');
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } }, 400);
  await registry.createAuditLogUseCase
    .execute({ actorId: null, action: 'BULK_PRICES_UNLOCKED', entity: 'bulk_price_access', entityId: 'bulk-prices', newState: { phone: result.maskedPhone } })
    .catch((err: unknown) => logger.warn({ err }, '[Quotes] audit write failed for bulk price access'));
  return c.json({ success: true, data: { token: result.token, expiresAt: result.expiresAt.toISOString(), maskedPhone: result.maskedPhone } });
});

export default routes;
