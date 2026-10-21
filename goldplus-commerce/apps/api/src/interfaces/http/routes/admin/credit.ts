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

// Registered before '/:id' so 'ledger' is never read as a card id.
routes.get('/ledger', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  // Dates are Kampala days: from 00:00 EAT on `from` to 00:00 EAT the day after `to`.
  const day = (v: string | undefined, plusDays = 0) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T00:00:00+03:00`);
    return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + plusDays * 86_400_000);
  };
  const from = day(c.req.query('from'));
  const to = day(c.req.query('to'), 1);
  const data = from && to ? await Registry.getInstance().manageCreditUseCases.ledgerBetween(from, to) : null;
  if (!data) return c.json({ success: false, error: { code: 'BAD_PERIOD', message: 'Choose a from and to date, at most about a year apart.' } } satisfies ApiResponse<never>, 400);
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

// 0200: occasion adjustments (registered before '/:id'). Prominence only: every occasion stays selectable.
routes.get('/occasions', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  const uc = Registry.getInstance().giftCardOccasionUseCases;
  // ?on=YYYY-MM-DD previews another day (what the buy page will show then).
  const data = { settings: await uc.settings(), today: await uc.orderFor(new Date(), c.req.query('on') ?? null) };
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});
routes.put('/occasions', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const user = c.get('user') as { id: string };
  const result = await Registry.getInstance().giftCardOccasionUseCases.save(body, user.id);
  if (!result.ok) return c.json({ success: false, error: { code: 'BAD_SETTINGS', message: result.message } } satisfies ApiResponse<never>, 400);
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: user.id, action: 'GIFT_CARD_OCCASIONS_SET', entity: 'gift_card_occasion_settings', entityId: '00000000-0000-4000-8000-000000000200', newState: result.value as never,
  }).catch(() => undefined);
  return c.json({ success: true, data: result.value });
});

// 0199: gift cards customers bought online (registered before '/:id').
routes.get('/purchases', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  const rows = await Registry.getInstance().giftCardPurchaseUseCases.recent(100);
  const data = rows.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null, issuedAt: p.issuedAt?.toISOString() ?? null, redirectUrl: undefined }));
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

/** Send the card to a different number: before issue the number changes; after, an untouched card gets a new code. */
routes.post('/purchases/:reference/redirect', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), requireStepUp('payment_refund'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const user = c.get('user') as { id: string };
  const reference = c.req.param('reference') ?? '';
  const result = await Registry.getInstance().giftCardPurchaseUseCases.redirect(reference, String(body?.phone ?? ''), user.id, String(body?.reason ?? ''));
  if (result.purchaseId) {
    await Registry.getInstance().createAuditLogUseCase.execute({
      actorId: user.id, action: result.ok ? 'GIFT_CARD_PURCHASE_REDIRECTED' : 'GIFT_CARD_PURCHASE_REDIRECT_REFUSED', entity: 'gift_card_purchase',
      entityId: result.purchaseId, newState: { reference, message: result.message.slice(0, 300) },
    }).catch(() => undefined);
  }
  if (!result.ok) return c.json({ success: false, error: { code: 'NOT_REDIRECTED', message: result.message } } satisfies ApiResponse<never>, 400);
  return c.json({ success: true, data: result });
});

/** The buyer's money goes back through Pesapal; the card (if issued and untouched) is cancelled first. */
routes.post('/purchases/:reference/refund', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), requireStepUp('payment_refund'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const user = c.get('user') as { id: string; email?: string | null };
  const reference = c.req.param('reference') ?? '';
  const result = await Registry.getInstance().giftCardPurchaseUseCases.refund(reference, { id: user.id, username: user.email ?? user.id }, String(body?.reason ?? ''));
  if (result.purchaseId) {
    await Registry.getInstance().createAuditLogUseCase.execute({
      actorId: user.id, action: result.ok ? 'GIFT_CARD_PURCHASE_REFUNDED' : 'GIFT_CARD_PURCHASE_REFUND_REFUSED', entity: 'gift_card_purchase',
      entityId: result.purchaseId, newState: { reference, message: result.message.slice(0, 300) },
    }).catch(() => undefined);
  }
  if (!result.ok) return c.json({ success: false, error: { code: 'NOT_REFUNDED', message: result.message } } satisfies ApiResponse<never>, 400);
  return c.json({ success: true, data: result });
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
  // A date from the form means "valid through that day" in Kampala, not midnight UTC (03:00 EAT that morning).
  const rawExpiry = typeof body?.expiresAt === 'string' ? body.expiresAt.trim() : '';
  const expires = rawExpiry ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(rawExpiry) ? `${rawExpiry}T23:59:59+03:00` : rawExpiry) : null;
  if (expires && !Number.isNaN(expires.getTime()) && expires.getTime() <= Date.now()) {
    return c.json({ success: false, error: { code: 'BAD_EXPIRY', message: 'The expiry date is in the past.' } } satisfies ApiResponse<never>, 400);
  }
  const result = await Registry.getInstance().issueCreditUseCase.execute({
    kind, amountUgx: Number(body?.amountUgx), reason: String(body?.reason ?? ''), recipientName: body?.recipientName ?? null,
    recipientPhone: body?.recipientPhone ?? null, actorId: actor(c), expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
    orderNumber: typeof body?.orderNumber === 'string' ? body.orderNumber : null,
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  // The code is in this response ONCE (it is stored only as a hash); never in the audit row.
  await audit(actor(c), 'CREDIT_ISSUED', result.id, { kind, amountUgx: Number(body?.amountUgx), status: result.status, masked: result.masked, texted: result.texted });
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: result });
});

routes.post('/return', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), requireStepUp('payment_refund'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const amount = Number(body?.amountUgx);
  const result = await Registry.getInstance().manageCreditUseCases.returnToCard(body?.orderNumber, amount, actor(c), String(body?.note ?? ''));
  if (!result.ok) return c.json({ success: false, error: { code: 'NOT_RETURNED', message: result.message } } satisfies ApiResponse<never>, 400);
  await audit(actor(c), 'CREDIT_RETURNED', result.instrumentId, { orderNumber: String(body?.orderNumber ?? '').toUpperCase(), amountUgx: amount, note: String(body?.note ?? '').slice(0, 200) });
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
