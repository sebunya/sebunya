import { Hono } from 'hono';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { PERMISSIONS } from '@goldplus/shared';

const measurementPaidSocialRoutes = new Hono();
const registry = Registry.getInstance();

measurementPaidSocialRoutes.use('*', authMiddleware);

measurementPaidSocialRoutes.get('/destinations', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const result = await registry.listPaidSocialDestinationsUseCase.execute();
  return c.json({ success: true, status: 'OK', data: result });
});

measurementPaidSocialRoutes.get('/health', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const result = await registry.getPaidSocialDeliveryHealthUseCase.execute();
  return c.json({ success: true, status: 'OK', data: result });
});

// audit-exempt: Updates should create an audit log, but for now we keep it simple
measurementPaidSocialRoutes.post('/destinations/:id/update', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const destinationId = c.req.param('id');
  if (!destinationId) return c.json({ success: false, status: 'ERROR', error: 'Missing id' });
  const body = await c.req.json();
  const result = await registry.updatePaidSocialDestinationUseCase.execute(destinationId, body);
  return c.json({ success: true, status: 'OK', data: result });
});

// Re-sending a conversion event to an ad platform is an outbound mutation with
// a privacy dimension, not a "transient operational command": it needs a
// mutating right and a record of who did it.
measurementPaidSocialRoutes.post('/delivery/:eventId/retry', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const eventId = c.req.param('eventId');
  if (!eventId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    return c.json({ success: false, status: 'ERROR', error: 'Missing or malformed eventId' }, 400);
  }
  const result = await registry.retryPaidSocialDeliveryUseCase.execute(eventId);
  await registry.createAuditLogUseCase.execute({
    actorId: (c.get('user') as { id?: string } | undefined)?.id ?? 'unknown',
    action: 'PAID_SOCIAL_DELIVERY_RETRIED',
    entity: 'paid_social_delivery',
    entityId: eventId,
    newState: { retried: true },
  }).catch(() => undefined);
  return c.json({ success: true, status: 'OK', data: result });
});

export default measurementPaidSocialRoutes;
