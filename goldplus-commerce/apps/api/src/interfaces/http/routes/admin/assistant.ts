import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

/**
 * Shop-assistant operations: month spend, ledger counts, the policy (budget,
 * fairness, abuse ceilings, model) and the two switches. Reading needs
 * analytics.read; changing the policy needs settings.manage. Every save is
 * audited. audit-exempt: reads only; the PUT audits inline below.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: Context, data: T) => c.json({ success: true, data });
const bad = (c: Context, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } }, status as 400);
const actor = (c: Context): string => (c.get('user') as { id: string }).id;

routes.get('/status', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => ok(c, await Registry.getInstance().assistantAdmissionUseCases.status()));

routes.get('/config', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => ok(c, await Registry.getInstance().assistantAdmissionUseCases.config()));

routes.put('/config', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const parsed = z.object({ expectedVersion: z.number().int().min(0), config: z.record(z.unknown()) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const registry = Registry.getInstance();
  const before = await registry.assistantAdmissionUseCases.config();
  const saved = await registry.assistantAdmissionUseCases.saveConfig(parsed.data.config, parsed.data.expectedVersion, actor(c));
  if (!saved) return bad(c, 'VERSION_CONFLICT', 'Someone else changed the assistant settings; reload and try again.', 409);
  const after = await registry.assistantAdmissionUseCases.config();
  await registry.createAuditLogUseCase.execute({
    actorId: actor(c), action: 'ASSISTANT_CONFIG_UPDATED', entity: 'assistant_config', entityId: 'global',
    previousState: { version: before.version, config: before.config }, newState: { version: saved.version, config: after.config },
  });
  return ok(c, { version: saved.version, config: after.config });
});

export default routes;
