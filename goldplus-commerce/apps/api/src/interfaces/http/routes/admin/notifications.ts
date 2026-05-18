import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();

routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.NOTIFICATIONS_READ]), async (c) => {
  const queryLimit = c.req.query('limit');
  const limit = queryLimit ? parseInt(queryLimit, 10) : 50;

  const registry = Registry.getInstance();
  const rawAttempts = await registry.listRecentNotificationsUseCase.execute({
    limit: isNaN(limit) ? 50 : limit
  });

  // Serialize dates safely and structure return DTO
  const attempts = rawAttempts.map(a => ({
    id: a.id,
    channel: a.channel,
    recipient: a.recipient,
    template: a.template,
    status: a.status,
    providerCode: a.providerCode,
    providerMessage: a.providerMessage,
    relatedEntity: a.relatedEntity,
    relatedEntityId: a.relatedEntityId,
    attemptedAt: a.attemptedAt.toISOString(),
  }));

  const response: ApiResponse<typeof attempts> = {
    success: true,
    data: attempts
  };

  return c.json(response);
});

routes.get('/health-check', requirePermissions([PERMISSIONS.NOTIFICATIONS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const sms = await (registry.smsAdapter as any).getBalance();
  const email = await (registry.zeptoMailAdapter as any).getBalance();

  return c.json({
    success: true,
    data: {
      sms,
      email,
    }
  });
});

export default routes;
