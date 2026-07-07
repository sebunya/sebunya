import { Hono } from 'hono';
import { BrowserTelemetryEventSchema } from '@goldplus/shared';
import { botDetectionMiddleware } from '../middleware/botDetection';
import { logger } from '../../../infrastructure/logging/logger';
import { TrackBrowserTelemetryEventUseCase } from '../../../application/use-cases/telemetry/TrackBrowserTelemetryEventUseCase';
import { StitchBrowserIdentityUseCase } from '../../../application/use-cases/telemetry/StitchBrowserIdentityUseCase';

const routes = new Hono();
const trackUseCase = new TrackBrowserTelemetryEventUseCase();
const stitchUseCase = new StitchBrowserIdentityUseCase();

const MAX_BATCH_SIZE = 20; // Max events per batch request

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6–11 — SINGLE EVENT INGESTION
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/collect', botDetectionMiddleware, async (c) => {
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 102_400) {
    return c.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  const body = (c as any)._parsedBody ?? await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: 'BAD_JSON' }, 400);

  const parsed = BrowserTelemetryEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'SCHEMA_VIOLATION', issues: parsed.error.flatten() }, 422);
  }

  // Defensive runtime guard
  if ((parsed.data as any).event_name === 'purchase') {
    return c.json({ success: false, error: 'PURCHASE_SERVER_ONLY' }, 403);
  }

  const realIp = (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
  const realUa = c.req.header('user-agent') || '';

  try {
    await trackUseCase.execute(parsed.data, realIp, realUa);
    return c.json({ success: true, event_id: parsed.data.event_id }, 202);
  } catch (err) {
    logger.error({ err, eventId: parsed.data.event_id }, '[Telemetry] Enqueue failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6–11 — BATCH EVENT INGESTION
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/collect/batch', botDetectionMiddleware, async (c) => {
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 512_000) {
    return c.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  const body = (c as any)._parsedBody ?? await c.req.json().catch(() => null);
  if (!Array.isArray(body)) {
    return c.json({ success: false, error: 'EXPECTED_ARRAY' }, 400);
  }

  if (body.length > MAX_BATCH_SIZE) {
    return c.json({ success: false, error: 'BATCH_TOO_LARGE', max: MAX_BATCH_SIZE }, 400);
  }

  const realIp = (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
  const realUa = c.req.header('user-agent') || '';

  const results: { event_id: string; ok: boolean; error?: string }[] = [];

  for (const item of body) {
    if ((item as any)?.event_name === 'purchase') {
      results.push({ event_id: item?.event_id ?? 'unknown', ok: false, error: 'PURCHASE_SERVER_ONLY' });
      continue;
    }

    const parsed = BrowserTelemetryEventSchema.safeParse(item);
    if (!parsed.success) {
      results.push({ event_id: item?.event_id ?? 'unknown', ok: false, error: 'SCHEMA_VIOLATION' });
      continue;
    }

    try {
      await trackUseCase.execute(parsed.data, realIp, realUa);
      results.push({ event_id: parsed.data.event_id, ok: true });
    } catch (err) {
      logger.error({ err, eventId: parsed.data.event_id }, '[Telemetry] Batch enqueue failed');
      results.push({ event_id: parsed.data.event_id, ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  const allOk = results.every(r => r.ok);
  return c.json({ success: allOk, results }, allOk ? 202 : 207);
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — IDENTITY SIGNAL CAPTURE
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/identity', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.fp_client_id !== 'string' || !body.fp_client_id.startsWith('fp.')) {
    return c.json({ success: false, error: 'INVALID_FP_CLIENT_ID' }, 400);
  }

  const realIp = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || '';
  const realUa = c.req.header('user-agent') || '';

  try {
    await stitchUseCase.execute(body, realIp, realUa);
    return c.json({ success: true }, 200);
  } catch (err) {
    logger.error({ err, fpClientId: body.fp_client_id }, '[Telemetry] Identity stitch failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

export default routes;
