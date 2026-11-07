import { Hono } from 'hono';
import { PERMISSIONS, ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { LAYBY_PLAN_STATUSES, type LaybyPlanStatus } from '../../../../domain/layby/PayInParts';

/**
 * 0222: pay in parts (lay-by). Reading needs payments.read. Cancelling a plan records the refund owed (paid less the
 * fee) and opens a Care Desk task for a person to send it, so it needs payments.refund. The settings need
 * settings.manage. Every action is audited.
 */
const routes = new Hono();
routes.use('*', authMiddleware);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

routes.get('/', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  const q = c.req.query('status');
  const status = q && (LAYBY_PLAN_STATUSES as readonly string[]).includes(q) ? (q as LaybyPlanStatus) : null;
  const uc = Registry.getInstance().payInPartsUseCases;
  const data = { plans: await uc.list(status), settings: await uc.settings() };
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/:id/cancel', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  const user = c.get('user') as { id: string };
  if (!UUID.test(id)) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No such plan.' } } satisfies ApiResponse<never>, 404);
  const result = await Registry.getInstance().payInPartsUseCases.cancel(id, user.id, String(body?.reason ?? ''));
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: user.id, action: result.ok ? 'LAYBY_PLAN_CANCELLED' : 'LAYBY_PLAN_CANCEL_REFUSED', entity: 'layby_plan', entityId: id,
    newState: { message: result.message.slice(0, 300), refundUgx: result.plan?.refundUgx ?? null, feeUgx: result.plan?.feeUgx ?? null },
  }).catch(() => undefined);
  if (!result.ok) return c.json({ success: false, error: { code: 'NOT_CANCELLED', message: result.message } } satisfies ApiResponse<never>, 400);
  return c.json({ success: true, data: { message: result.message } });
});

routes.put('/settings', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  const user = c.get('user') as { id: string };
  const key = String(body?.key ?? '');
  const result = await Registry.getInstance().payInPartsUseCases.saveSetting(key, body?.value, user.id);
  if (!result.ok) return c.json({ success: false, error: { code: 'BAD_SETTING', message: result.message } } satisfies ApiResponse<never>, 400);
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: user.id, action: 'LAYBY_SETTING_SET', entity: 'layby_settings', entityId: '00000000-0000-4000-8000-000000000222', newState: { key, value: result.value },
  }).catch(() => undefined);
  return c.json({ success: true, data: { key, value: result.value } });
});

export default routes;
