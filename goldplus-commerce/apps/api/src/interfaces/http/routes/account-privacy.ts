import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { customerSessionMiddleware } from '../middleware/customerSession';

/**
 * The signed-in customer's own data rights (0157, docs/first-party/README.md).
 * Mounted at /account/privacy. Download is served at once; anonymisation and
 * deletion are received here and carried out by a person. Every step is
 * audited in PrivacyRequestUseCases. Responses are never cached.
 *
 * audit-exempt: PrivacyRequestUseCases writes the audit row for every step.
 */
type Variables = { userId: string; userEmail: string };
const routes = new Hono<{ Variables: Variables }>();
routes.use('*', customerSessionMiddleware);
routes.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'private, no-store');
});

routes.get('/requests', async (c) => {
  const requests = await Registry.getInstance().privacyRequestUseCases.listMine(c.get('userId'));
  return c.json({ success: true, data: { requests } });
});

routes.get('/export', async (c) => {
  const r = await Registry.getInstance().privacyRequestUseCases.exportMyData(c.get('userId'));
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, r.code === 'EXPORT_LIMIT' ? 429 : 404);
  return c.json({ success: true, data: r });
});

routes.post('/requests', async (c) => {
  const body = await c.req.json().catch(() => null) as { kind?: unknown; note?: unknown } | null;
  const r = await Registry.getInstance().privacyRequestUseCases.requestErasure({
    userId: c.get('userId'),
    kind: typeof body?.kind === 'string' ? body.kind : '',
    note: typeof body?.note === 'string' ? body.note : null,
    idempotencyKey: c.req.header('idempotency-key') ?? null,
  });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, 400);
  return c.json({ success: true, data: r }, r.alreadyOpen ? 200 : 201);
});

routes.post('/requests/:id/withdraw', async (c) => {
  const r = await Registry.getInstance().privacyRequestUseCases.withdraw({ userId: c.get('userId'), requestId: String(c.req.param('id') ?? '') });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, r.code === 'NOT_FOUND' ? 404 : 409);
  return c.json({ success: true, data: r });
});

export default routes;
