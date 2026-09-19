import { Hono, type Context } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Advertising destinations (0138), mounted at /admin/advertising. Thin: the use
 * case validates ids, encrypts the token (write-only), enforces "complete
 * before live" and audits every change inside the use case
 * (createAuditLogUseCase, action AD_DESTINATION_CONFIGURED). Responses never
 * contain a token.
 */
const routes = new Hono();
routes.use('*', authMiddleware);
const svc = () => Registry.getInstance().advertising;
const STATUS: Record<string, number> = { NOT_FOUND: 404, BAD_INPUT: 400, NOT_CONFIGURED: 409 };

const view = async () => (await svc().list()).map((p) => ({
  key: p.key, name: p.name, state: p.state, unavailable: p.unavailable ?? null, secretLabel: p.secretLabel, secretHint: p.secretHint ?? null,
  fields: p.fields.map((f) => ({ key: f.key, label: f.label, hint: f.hint, optional: !!f.optional, value: p.row?.config?.[f.key] ?? '' })),
  events: p.events, enabled: p.row?.enabled ?? false, secretMask: p.row?.secretMask ?? null,
  lastSuccessAt: p.row?.lastSuccessAt ?? null, lastError: p.row?.lastError ?? null, lastErrorAt: p.row?.lastErrorAt ?? null,
  sentCount: p.row?.sentCount ?? 0, failedCount: p.row?.failedCount ?? 0,
}));

routes.get('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => c.json({ success: true, data: await view() }));
routes.put('/:platform', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c: Context) => {
  const b = (await c.req.json().catch(() => null)) as { config?: Record<string, unknown>; secret?: string; enabled?: boolean; removeSecret?: boolean } | null;
  const actorId = (c.get('user') as { id?: string } | undefined)?.id ?? null;
  const r = await svc().configure(actorId, c.req.param('platform') ?? '', { config: b?.config, secret: b?.secret, enabled: typeof b?.enabled === 'boolean' ? b.enabled : undefined, removeSecret: b?.removeSecret === true });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, (STATUS[r.code] ?? 400) as never);
  return c.json({ success: true, data: (await view()).find((p) => p.key === c.req.param('platform')) });
});

export default routes;
