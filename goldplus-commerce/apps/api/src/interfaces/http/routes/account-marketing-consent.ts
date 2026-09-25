import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { Registry } from '../../../infrastructure/Registry';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { clientIp } from '../clientAddress';

/**
 * The signed-in customer's own WhatsApp marketing choice (0155). Mounted at
 * /account/marketing-consent. Recording a choice sends nothing. The browser
 * never calls this directly: the preference page's server does, forwarding
 * the shopper's address (via the shared web helper) and browser for the evidence record,
 * which stores only their hashes.
 */
type Variables = { userId: string; userEmail: string };
const routes = new Hono<{ Variables: Variables }>();
routes.use('*', customerSessionMiddleware);

routes.get('/whatsapp', async (c) => {
  const data = await Registry.getInstance().whatsAppMarketingConsentUseCases.status(c.get('userId'));
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data });
});

routes.post('/whatsapp', async (c) => {
  const body = await c.req.json().catch(() => null) as { requested?: unknown; confirmation?: unknown; copyVersionId?: unknown } | null;
  if (!body || (body.requested !== 'granted' && body.requested !== 'withdrawn')) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Choose to switch WhatsApp offers on or off.' } }, 400);
  }
  const idempotencyKey = c.req.header('idempotency-key')?.trim() || randomUUID();
  const correlationId = c.req.header('x-correlation-id')?.trim() || randomUUID();
  const r = await Registry.getInstance().whatsAppMarketingConsentUseCases.change({
    userId: c.get('userId'),
    requested: body.requested,
    confirmationTicked: body.confirmation === true,
    copyVersionId: typeof body.copyVersionId === 'string' ? body.copyVersionId : null,
    idempotencyKey: idempotencyKey.slice(0, 120),
    correlationId: correlationId.slice(0, 120),
    // The one place client addresses are resolved (proxy-trust rules).
    ipAddress: clientIp(c),
    userAgent: c.req.header('x-shopper-user-agent') ?? c.req.header('user-agent') ?? null,
  });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, r.code === 'SIGNED_IN_ACCOUNT_REQUIRED' ? 401 : 400);
  return c.json({ success: true, data: r });
});

export default routes;
