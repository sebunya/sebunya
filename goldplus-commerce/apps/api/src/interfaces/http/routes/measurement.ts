import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZeroPartySignalSchema } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { logger } from '../../../infrastructure/logging/logger';
import { clientIp } from '../clientAddress';
import { authMiddleware } from '../middleware/auth';
import { requirePermissions } from '../middleware/permissions';
import { optionalCustomerSessionMiddleware } from '../middleware/customerSession';
import { PERMISSIONS } from '@goldplus/shared';

const registry = Registry.getInstance();
const routes = new Hono<{ Variables: { userId?: string } }>();
const captureZeroPartyUseCase = registry.captureZeroPartyDataUseCase;
const attributionService = registry.attributionService;

// ─────────────────────────────────────────────────────────────────────────────
// POST /measurement/zero-party — capture a zero-party signal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The cap is enforced while the body streams in: a chunked request declares no
 * Content-Length, so the header check alone let a 2 MB "signal" be buffered and
 * stored whole (the payload schema accepts any record).
 */
const zeroPartyLimit = bodyLimit({
  maxSize: 32_000,
  onError: (c: Context) => c.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, 413),
});

routes.post('/zero-party', zeroPartyLimit, optionalCustomerSessionMiddleware, async (c) => {
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 32_000) {
    return c.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: 'BAD_JSON' }, 400);

  const parsed = ZeroPartySignalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'SCHEMA_VIOLATION', issues: parsed.error.flatten() }, 422);
  }

  const realIp = clientIp(c);
  const realUa = c.req.header('user-agent') || '';

  try {
    // The account is the verified session's, never the body's. The answer is the
    // same whether the signal was kept or dropped for consent: a different
    // status or flag told the caller that account's personalisation choice.
    await captureZeroPartyUseCase.execute(parsed.data, realIp, realUa, c.get('userId') ?? null);
    return c.json({ success: true }, 202);
  } catch (err) {
    logger.error({ err }, '[Measurement] Zero-party capture failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /measurement/attribution/:orderId — attribution report for an order
// ─────────────────────────────────────────────────────────────────────────────

// An order's marketing journey is operator reporting, not public data, and the
// only caller is the admin console on its own admin route. Unauthenticated,
// this returned the full attribution trail for any order id.
routes.get('/attribution/:orderId', authMiddleware, requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const orderId = c.req.param('orderId');
  if (!orderId) return c.json({ success: false, error: 'ORDER_ID_REQUIRED' }, 400);

  try {
    const report = await attributionService.getAttributionReport(orderId);
    if (!report) {
      return c.json({ success: false, error: 'NOT_FOUND', message: 'No attribution data for this order.' }, 404);
    }
    return c.json({ success: true, data: report });
  } catch (err) {
    logger.error({ err, orderId }, '[Measurement] Attribution report failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /measurement/match-quality — aggregate match quality stats (last 7 days)
// ─────────────────────────────────────────────────────────────────────────────

// Operator reporting, like /attribution above; the console reads the admin twin
// (/admin/measurement/match-quality). `days=abc` parsed to NaN, which passed
// both range checks and surfaced as a 500.
routes.get('/match-quality', authMiddleware, requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const days = Number(c.req.query('days') || '7');
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return c.json({ success: false, error: 'INVALID_DAYS' }, 400);
  }

  try {
    const summary = await attributionService.getMatchQualitySummary(days);
    return c.json({ success: true, data: summary });
  } catch (err) {
    logger.error({ err }, '[Measurement] Match quality summary failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

export default routes;
