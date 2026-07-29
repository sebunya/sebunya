import { Hono } from 'hono';
import { ConsentSignalSchema, ConsentWithdrawalSchema } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { logger } from '../../../infrastructure/logging/logger';
import { clientIp } from '../clientAddress';

const routes = new Hono();
const registry = Registry.getInstance();
const consentService = registry.consentService;

// ─────────────────────────────────────────────────────────────────────────────
// POST /consent/signal — record a consent decision from the browser
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/signal', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: 'BAD_JSON' }, 400);
  }

  const parsed = ConsentSignalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'SCHEMA_VIOLATION', issues: parsed.error.flatten() }, 422);
  }

  const realIp = clientIp(c);
  const realUa = c.req.header('user-agent') || '';

  // Validate timing — reject signals more than 5 minutes in the past or future
  if (parsed.data.consent_at) {
    const ageSec = Math.abs(Date.now() / 1000 - parsed.data.consent_at);
    if (ageSec > 300) {
      logger.warn({ ageSec, fpClientId: parsed.data.fp_client_id }, '[Consent] Signal timestamp too old/future');
      return c.json({ success: false, error: 'TIMESTAMP_INVALID' }, 400);
    }
  }

  try {
    const result = await consentService.recordSignal(parsed.data, realIp, realUa);
    return c.json({ success: true, recordId: result.recordId, state: result.state }, 200);
  } catch (err) {
    logger.error({ err }, '[Consent] Failed to record signal');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /consent/status — retrieve current consent state for an identity
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/status', async (c) => {
  const fpClientId = c.req.query('fp_client_id');
  const userId     = c.req.query('user_id');

  if (!fpClientId && !userId) {
    return c.json({ success: false, error: 'IDENTITY_REQUIRED' }, 400);
  }

  const state = await consentService.getCurrentState(fpClientId, userId);
  return c.json({ success: true, data: state });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /consent/withdraw — record a consent withdrawal
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/withdraw', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: 'BAD_JSON' }, 400);

  const parsed = ConsentWithdrawalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'SCHEMA_VIOLATION', issues: parsed.error.flatten() }, 422);
  }

  const realIp = clientIp(c);
  const realUa = c.req.header('user-agent') || '';

  try {
    const result = await consentService.recordWithdrawal(parsed.data, realIp, realUa);
    return c.json({ success: true, recordId: result.recordId }, 200);
  } catch (err) {
    logger.error({ err }, '[Consent] Withdrawal failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

export default routes;
