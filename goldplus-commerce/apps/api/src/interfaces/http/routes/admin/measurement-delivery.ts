import { Hono, type Context } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Measurement delivery operations (0140/0141), mounted at /admin/measurement-delivery.
 * Thin: MeasurementOperationsUseCases validates, bounds, previews and audits
 * every change (createAuditLogUseCase inside the use case). Reads live from
 * PostgreSQL, so they work while analytics is offline.
 */
const routes = new Hono();
routes.use('*', authMiddleware);
const svc = () => Registry.getInstance().measurementOperations;
const actorId = (c: Context) => (c.get('user') as { id?: string } | undefined)?.id ?? null;
const body = async (c: Context) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
const STATUS: Record<string, number> = { BAD_INPUT: 400, NOT_FOUND: 404, CONFLICT: 409 };
const send = (c: Context, r: { ok: boolean; value?: unknown; code?: string; message?: string }) =>
  r.ok ? c.json({ success: true, data: r.value }) : c.json({ success: false, error: { code: r.code, message: r.message } }, (STATUS[r.code as string] ?? 400) as never);
const ids = (b: Record<string, unknown>) => (Array.isArray(b.ids) ? b.ids.map(String) : []);

routes.get('/summary', requirePermissions([PERMISSIONS.MEASUREMENT_DELIVERY_READ]), async (c) => c.json({ success: true, data: await svc().summary() }));
routes.get('/deliveries', requirePermissions([PERMISSIONS.MEASUREMENT_DELIVERY_READ]), async (c) =>
  c.json({ success: true, data: await svc().list({ states: (c.req.query('states') ?? '').split(',').filter(Boolean), sink: c.req.query('sink'), limit: Number(c.req.query('limit') ?? 50), before: c.req.query('before') }) }));
routes.get('/deliveries/:id', requirePermissions([PERMISSIONS.MEASUREMENT_DELIVERY_READ]), async (c) => send(c, await svc().get(c.req.param('id') ?? '')));
routes.post('/replay/preview', requirePermissions([PERMISSIONS.MEASUREMENT_REPLAY]), async (c) => send(c, await svc().previewReplay(ids(await body(c)))));
routes.post('/replay', requirePermissions([PERMISSIONS.MEASUREMENT_REPLAY]), async (c) => {
  const b = await body(c);
  return send(c, await svc().replay(actorId(c), ids(b), String(b.digest ?? ''), String(b.reason ?? '')));
});
routes.post('/quarantine', requirePermissions([PERMISSIONS.MEASUREMENT_REPLAY]), async (c) => {
  const b = await body(c);
  return send(c, await svc().quarantine(actorId(c), ids(b), String(b.reason ?? ''), b.cancel === true ? 'CANCELLED' : 'QUARANTINED'));
});
routes.post('/kill-switch', requirePermissions([PERMISSIONS.MEASUREMENT_KILL]), async (c) => {
  const b = await body(c);
  return send(c, await svc().setKillSwitch(actorId(c), b.on === true, String(b.reason ?? '')));
});

routes.get('/attribution', requirePermissions([PERMISSIONS.MEASUREMENT_DELIVERY_READ]), async (c) => c.json({ success: true, data: await svc().attributionLatest() }));
routes.post('/attribution/run', requirePermissions([PERMISSIONS.MEASUREMENT_REPLAY]), async (c) => send(c, await svc().runAttribution(actorId(c), String((await body(c)).reason ?? ''))));

export default routes;
