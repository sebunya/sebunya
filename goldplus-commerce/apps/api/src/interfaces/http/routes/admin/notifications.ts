import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();

routes.use('*', authMiddleware);

function maskRecipient(recipient: string | null | undefined, channel: string): string {
  if (!recipient) return '';
  const clean = recipient.trim();
  if (channel.toLowerCase() === 'email') {
    const atIndex = clean.indexOf('@');
    if (atIndex <= 0) return clean;
    const localPart = clean.slice(0, atIndex);
    const domainPart = clean.slice(atIndex);
    if (localPart.length <= 2) {
      return localPart + '****' + domainPart;
    }
    return localPart.slice(0, 2) + '****' + domainPart;
  } else {
    // Phone masking: e.g. 256705004545 -> 25670******45
    if (clean.length < 7) return clean;
    const start = clean.slice(0, 5);
    const end = clean.slice(-2);
    const middleLength = clean.length - 7;
    const maskedMiddle = '*'.repeat(middleLength);
    return start + maskedMiddle + end;
  }
}

function scrubMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return message
    .replace(/bearer\s+[a-z0-9\-_\.]+/gi, 'Bearer [REDACTED]')
    .replace(/(api_key|apikey|secret|password|token)=\s*[a-z0-9\-_\.]+/gi, '$1=[REDACTED]');
}

routes.get('/', requirePermissions([PERMISSIONS.NOTIFICATIONS_READ]), async (c) => {
  const queryLimit = c.req.query('limit');
  const limit = queryLimit ? parseInt(queryLimit, 10) : 50;

  const registry = Registry.getInstance();
  const rawAttempts = await registry.listRecentNotificationsUseCase.execute({
    limit: isNaN(limit) ? 50 : limit
  });

  // Serialize dates safely and structure return DTO with masking
  const attempts = rawAttempts.map(a => ({
    id: a.id,
    channel: a.channel,
    recipient: maskRecipient(a.recipient, a.channel),
    template: a.template,
    status: a.status,
    providerCode: a.providerCode,
    providerMessage: scrubMessage(a.providerMessage),
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

routes.get('/order/:orderId/timeline', requirePermissions([PERMISSIONS.NOTIFICATIONS_READ]), async (c) => {
  const orderId = c.req.param('orderId');
  if (!orderId) {
    return c.json({
      success: false,
      error: {
        code: 'ORDER_ID_REQUIRED',
        message: 'Order ID parameter is required'
      }
    }, 400);
  }
  const registry = Registry.getInstance();

  try {
    const rawItems = await registry.listOrderNotificationsUseCase.execute(orderId);
    
    const items = rawItems.map(item => ({
      ...item,
      recipient: maskRecipient(item.recipient, item.channel),
      providerMessage: scrubMessage(item.providerMessage),
      timestamp: item.timestamp.toISOString(),
    }));

    const response: ApiResponse<typeof items> = {
      success: true,
      data: items
    };

    return c.json(response);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({
      success: false,
      error: {
        code: 'TIMELINE_QUERY_FAILED',
        message: errorMsg
      }
    }, 400);
  }
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
