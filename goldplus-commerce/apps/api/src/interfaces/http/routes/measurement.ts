import { Hono } from 'hono';
import { ZeroPartySignalSchema } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { logger } from '../../../infrastructure/logging/logger';
import { clientIp } from '../clientAddress';

const registry = Registry.getInstance();
const routes = new Hono();
const captureZeroPartyUseCase = registry.captureZeroPartyDataUseCase;
const attributionService = registry.attributionService;

// ─────────────────────────────────────────────────────────────────────────────
// POST /measurement/zero-party — capture a zero-party signal
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/zero-party', async (c) => {
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
    const result = await captureZeroPartyUseCase.execute(parsed.data, realIp, realUa);
    return c.json({ success: true, captured: result.captured, id: result.id }, result.captured ? 201 : 200);
  } catch (err) {
    logger.error({ err }, '[Measurement] Zero-party capture failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /measurement/attribution/:orderId — attribution report for an order
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/attribution/:orderId', async (c) => {
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

routes.get('/match-quality', async (c) => {
  const days = parseInt(c.req.query('days') || '7', 10);
  if (days < 1 || days > 90) {
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
