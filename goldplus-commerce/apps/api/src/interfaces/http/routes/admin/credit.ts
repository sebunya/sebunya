import { Hono } from 'hono';
import { PERMISSIONS, ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { requireStepUp } from '../../middleware/requireStepUp';

/**
 * Store credit and gift cards (0196, gap analysis #17). Reading needs payments.read. Every action that creates,
 * releases or removes spendable money needs payments.refund AND a fresh step-up, exactly like a refund: a card is
 * money. Every action is audited. A card above UGX 500,000 waits for a second, different person to approve it.
 */
const routes = new Hono();
routes.use('*', authMiddleware);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actor = (c: { get(k: string): unknown }) => (c.get('user') as { id: string }).id;
const audit = (actorId: string, action: string, entityId: string, newState: Record<string, unknown>) =>
  Registry.getInstance().createAuditLogUseCase.execute({ actorId, action, entity: 'credit_instrument', entityId, newState }).catch(() => undefined);

routes.get('/', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  const status = c.req.query('status') ?? null;
  const kind = c.req.query('kind') === 'gift_card' || c.req.query('kind') === 'store_credit' ? (c.req.query('kind') as 'gift_card' | 'store_credit') : null;
  const data = await Registry.getInstance().manageCreditUseCases.list({ status, kind, limit: 200 });
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.get('/:id', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  const id = c.req.param('id') ?? '';
  const data = UUID.test(id) ? await Registry.getInstance().manageCreditUseCases.detail(id) : null;
  if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No such card.' } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), requireStepUp('payment_refund'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const kind = body?.kind === 'gift_card' ? 'gift_card' : body?.kind === 'store_credit' ? 'store_credit' : null;
  if (!kind) return c.json({ success: false, error: { code: 'BAD_KIND', message: 'Choose gift card or store credit.' } } satisfies ApiResponse<never>, 400);
  const expires = typeof body?.expiresAt === 'string' && body.expiresAt ? new Date(body.expiresAt) : null;
  const result = await Registry.getInstance().issueCreditUseCase.execute({
    kind, amountUgx: Number(body?.amountUgx), reason: String(body?.reason ?? ''), recipientName: body?.recipientName ?? null,
    recipientPhone: body?.recipientPhone ?? null, actorId: actor(c), expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  // The code is in this response ONCE (it is stored only as a hash); never in the audit row.
  await audit(actor(c), 'CREDIT_ISSUED', result.id, { kind, amountUgx: Number(body?.amountUgx), status: result.status, masked: result.masked, texted: result.texted });
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: result });
});

routes.post('/:id/approve', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), requireStepUp('payment_refund'), async (c) => {
  const id = c.req.param('id') ?? '';
  const ok = UUID.test(id) && (await Registry.getInstance().manageCreditUseCases.approve(id, actor(c)));
  if (!ok) return c.json({ success: false, error: { code: 'NOT_APPROVED', message: 'Not approved: it is not waiting for approval, or you issued it (a different person must approve).' } } satisfies ApiResponse<never>, 409);
  await audit(actor(c), 'CREDIT_APPROVED', id, {});
  return c.json({ success: true, data: { approved: true } });
});

routes.post('/:id/void', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), requireStepUp('payment_refund'), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  const result = UUID.test(id) ? await Registry.getInstance().manageCreditUseCases.void(id, actor(c), String(body?.note ?? '')) : { ok: false, message: 'No such card.' };
  if (!result.ok) return c.json({ success: false, error: { code: 'NOT_VOIDED', message: result.message ?? 'Not cancelled.' } } satisfies ApiResponse<never>, 400);
  await audit(actor(c), 'CREDIT_VOIDED', id, { voidedUgx: result.voidedUgx ?? 0, note: String(body?.note ?? '').slice(0, 200) });
  return c.json({ success: true, data: result });
});

routes.post('/:id/adjust', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), requireStepUp('payment_refund'), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  const amount = Number(body?.amountUgx);
  const result = UUID.test(id) ? await Registry.getInstance().manageCreditUseCases.adjust(id, amount, actor(c), String(body?.note ?? '')) : { ok: false, message: 'No such card.' };
  if (!result.ok) return c.json({ success: false, error: { code: 'NOT_ADJUSTED', message: result.message ?? 'Not changed.' } } satisfies ApiResponse<never>, 400);
  await audit(actor(c), 'CREDIT_ADJUSTED', id, { amountUgx: amount, note: String(body?.note ?? '').slice(0, 200) });
  return c.json({ success: true, data: result });
});

export default routes;
