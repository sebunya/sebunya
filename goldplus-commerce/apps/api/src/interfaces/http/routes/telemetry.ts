import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { BrowserTelemetryEventSchema, fpClientIdFromCookieHeader, gaSessionFromCookieHeader } from '@goldplus/shared';
import { botDetectionMiddleware } from '../middleware/botDetection';
import { logger } from '../../../infrastructure/logging/logger';
import { TrackBrowserTelemetryEventUseCase } from '../../../application/use-cases/telemetry/TrackBrowserTelemetryEventUseCase';
import { StitchBrowserIdentityUseCase } from '../../../application/use-cases/telemetry/StitchBrowserIdentityUseCase';
import { exceedsBrowserValueCeiling, withoutBrowserAuthority } from '../../../application/use-cases/telemetry/BrowserTelemetryAuthority';
import { isDeclaredAutomationUa } from '../../../application/use-cases/telemetry/DeclaredAutomation';
import { clientIp, proxyConfig } from '../clientAddress';
import { Registry } from '../../../infrastructure/Registry';

const routes = new Hono();
const trackUseCase = new TrackBrowserTelemetryEventUseCase();
const stitchUseCase = new StitchBrowserIdentityUseCase();

const MAX_BATCH_SIZE = 20; // Max events per batch request

/**
 * Body caps enforced WHILE the body streams in. The Content-Length checks below
 * only see what the caller declares, and a chunked request declares nothing, so
 * a multi-megabyte body sailed through them into memory (and into the tables).
 * Mounted before botDetectionMiddleware, which is the first thing to read it.
 */
const tooLarge = (c: Context) => c.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
const collectLimit = bodyLimit({ maxSize: 102_400, onError: tooLarge });
const batchLimit = bodyLimit({ maxSize: 512_000, onError: tooLarge });
const identityLimit = bodyLimit({ maxSize: 4_096, onError: tooLarge });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6–11 — SINGLE EVENT INGESTION
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/collect', collectLimit, botDetectionMiddleware, async (c) => {
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
  if (exceedsBrowserValueCeiling(parsed.data)) {
    return c.json({ success: false, error: 'VALUE_OUT_OF_RANGE' }, 422);
  }
  // A page may observe, not name who it is: user_id / hashed PII are dropped
  // and the server's own _fp_cid wins over the page's claim.
  const event = withoutBrowserAuthority(parsed.data, fpClientIdFromCookieHeader(c.req.header('cookie')));

  const realIp = clientIp(c);
  const realUa = c.req.header('user-agent') || '';
  // Our own probes and lab tools are not shoppers: accepted, not recorded, and
  // so never forwarded to GA4 or an ad platform.
  if (isDeclaredAutomationUa(realUa)) return c.json({ success: true, event_id: parsed.data.event_id }, 202);

  try {
    await trackUseCase.execute(event, realIp, realUa, gaSessionFromCookieHeader(c.req.header('cookie')));
    return c.json({ success: true, event_id: parsed.data.event_id }, 202);
  } catch (err) {
    logger.error({ err, eventId: parsed.data.event_id }, '[Telemetry] Enqueue failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6–11 — BATCH EVENT INGESTION
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/collect/batch', batchLimit, botDetectionMiddleware, async (c) => {
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 512_000) {
    return c.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  const parsedBody = (c as any)._parsedBody;
  const body = parsedBody ?? await c.req.json().catch(() => null);
  // Collector contract v2: an envelope with a batchId gets a durable receipt.
  if (body && !Array.isArray(body) && typeof body === 'object' && 'batchId' in body) {
    const realIp = clientIp(c);
    const realUa = c.req.header('user-agent') || '';
    const gaSession = gaSessionFromCookieHeader(c.req.header('cookie'));
    const serverVisitorId = fpClientIdFromCookieHeader(c.req.header('cookie'));
    // Declared automation: its landing touch is still filed (as 'automated'),
    // but no behavioural event is enqueued for GA4 or the ad platforms.
    const declaredAutomation = isDeclaredAutomationUa(realUa);
    const uc = Registry.getInstance().collectBrowserBatch((ev: unknown) =>
      declaredAutomation
        ? Promise.resolve()
        : trackUseCase.execute(withoutBrowserAuthority(ev as never, serverVisitorId), realIp, realUa, gaSession));
    try {
      // Cloudflare's own score is the only automation signal we can trust here,
      // and only when Cloudflare is actually the edge. An outright bot never
      // reaches this handler (botDetectionMiddleware answers 204 first), so a
      // borderline score is what is left to record — never a guess from the UA.
      const score = proxyConfig().mode === 'CLOUDFLARE_EDGE' ? parseInt(c.req.header('x-cf-bot-score') ?? '100', 10) : 100;
      // Lighthouse and the like drive Chrome over CDP, so `navigator.webdriver`
      // is false and the page cannot tell. The user agent it sends can, and our
      // own probes are told to name themselves (scripts/lighthouse-watch.sh).
      const automatedUa = declaredAutomation;
      const trafficClass = automatedUa || (Number.isFinite(score) && score < 60) ? 'automated' as const : 'customer' as const;
      const r = await uc.execute(JSON.stringify(body), trafficClass, fpClientIdFromCookieHeader(c.req.header('cookie')));
      if (r.status === 202) return c.json({ success: true, receiptId: r.receipt.receiptId, accepted: r.receipt.accepted, rejected: r.receipt.rejected, replay: r.replay }, 202);
      return c.json({ success: false, error: r.error }, r.status);
    } catch (err) {
      logger.error({ err }, '[Telemetry] collector v2 unavailable');
      return c.json({ success: false, error: 'NO_DURABLE_SINK' }, 503);
    }
  }
  if (!Array.isArray(body)) {
    return c.json({ success: false, error: 'EXPECTED_ARRAY' }, 400);
  }

  if (body.length > MAX_BATCH_SIZE) {
    return c.json({ success: false, error: 'BATCH_TOO_LARGE', max: MAX_BATCH_SIZE }, 400);
  }

  const realIp = clientIp(c);
  const realUa = c.req.header('user-agent') || '';

  const results: { event_id: string; ok: boolean; error?: string }[] = [];
  const declaredAutomation = isDeclaredAutomationUa(realUa);

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
    if (exceedsBrowserValueCeiling(parsed.data)) {
      results.push({ event_id: parsed.data.event_id, ok: false, error: 'VALUE_OUT_OF_RANGE' });
      continue;
    }

    if (declaredAutomation) { results.push({ event_id: parsed.data.event_id, ok: true }); continue; }

    try {
      await trackUseCase.execute(
        withoutBrowserAuthority(parsed.data, fpClientIdFromCookieHeader(c.req.header('cookie'))),
        realIp,
        realUa,
        gaSessionFromCookieHeader(c.req.header('cookie')),
      );
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

/**
 * What a page may report here: its first-party id and the ad click ids it saw
 * in its own URL. Nothing else. user_id, email and phone used to be taken from
 * this unauthenticated body, so anyone could bind any customer (or any email)
 * to any browser id; a non-uuid user_id was a 500, and an object where a click
 * id belonged was stored as '[object Object]'. Unknown keys are dropped.
 */
const clickId = z.string().max(512).optional();
const IdentitySignalSchema = z.object({
  fp_client_id: z.string().startsWith('fp.').max(255),
  gclid: clickId,
  wbraid: clickId,
  gbraid: clickId,
  fbc: clickId,
  fbp: clickId,
  ttclid: clickId,
  twclid: clickId,
  li_fat_id: clickId,
  epik: clickId,
});

routes.post('/identity', identityLimit, botDetectionMiddleware, async (c) => {
  const raw = (c as any)._parsedBody ?? await c.req.json().catch(() => null);
  const parsed = IdentitySignalSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ success: false, error: 'INVALID_FP_CLIENT_ID' }, 400);
  }
  const body = parsed.data;

  const realIp = clientIp(c);
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
