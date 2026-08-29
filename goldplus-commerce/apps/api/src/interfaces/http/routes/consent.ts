import { Hono } from 'hono';
import { ConsentSignalSchema, ConsentWithdrawalSchema } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { logger } from '../../../infrastructure/logging/logger';
import { clientIp } from '../clientAddress';
import { optionalCustomerSessionMiddleware } from '../middleware/customerSession';

const routes = new Hono<{ Variables: { userId?: string } }>();

// A logged-out browser legitimately records consent against its own
// fp_client_id, so these stay public. What they must NOT do is take the
// caller's word for WHICH ACCOUNT a decision belongs to: user_id used to come
// straight from the request body, so anyone could grant, withdraw or read the
// consent of any account whose uuid they had. The account is now whoever the
// session says it is, and nobody if there is no session.
routes.use('*', optionalCustomerSessionMiddleware);
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
    const result = await consentService.recordSignal(
      { ...parsed.data, user_id: c.get('userId') },
      realIp,
      realUa,
    );
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
  const requestedUserId = c.req.query('user_id');
  const sessionUserId = c.get('userId');

  // An account's consent state is readable only by that account. Anonymous
  // callers get the fp_client_id view and nothing else.
  if (requestedUserId && requestedUserId !== sessionUserId) {
    return c.json({ success: false, error: 'FORBIDDEN' }, 403);
  }
  const userId = requestedUserId ? sessionUserId : undefined;

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
    const result = await consentService.recordWithdrawal(
      { ...parsed.data, user_id: c.get('userId') },
      realIp,
      realUa,
    );
    return c.json({ success: true, recordId: result.recordId }, 200);
  } catch (err) {
    logger.error({ err }, '[Consent] Withdrawal failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

export default routes;
