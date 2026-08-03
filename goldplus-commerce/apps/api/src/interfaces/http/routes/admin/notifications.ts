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
    .replace(/bearer\s+[a-z0-9\-_.]+/gi, 'Bearer [REDACTED]')
    .replace(/(api_key|apikey|secret|password|token)=\s*[a-z0-9\-_.]+/gi, '$1=[REDACTED]');
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

// --- Transactional admin order email (outbox intents + manual replay) ---
// audit-exempt: the only write endpoint (POST /admin-order-emails/:id/replay)
// delegates to ReplayAdminOrderEmailUseCase, which writes the outbox_event audit
// entry via CreateAuditLogUseCase — a dedicated audit channel.

function deliveryStateOf(row: { isProcessed: boolean; status: string; attemptCount: number; lastError?: string | null; dryRunOnly: boolean }): string {
  if (!row.isProcessed) return row.attemptCount > 0 ? 'RETRYING' : 'PENDING';
  if (!row.lastError) return 'SENT';
  const e = row.lastError.toLowerCase();
  if (e.includes('exhausted')) return 'DEAD_LETTER';
  if (e.includes('not_configured') || e.includes('no channel')) return 'MISSING_CONFIG';
  if (e.includes('disabled')) return row.dryRunOnly ? 'DELIVERY_DISABLED' : 'DELIVERY_DISABLED';
  return 'RETRYING';
}

routes.get('/admin-order-emails', requirePermissions([PERMISSIONS.NOTIFICATIONS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const { parseAdminRecipients, maskAdminEmail } = await import('../../../../domain/notifications/AdminOrderEmail');
  const recipientCfg = parseAdminRecipients(process.env.ADMIN_ORDER_NOTIFICATION_EMAILS || process.env.OPS_ALERT_EMAIL);
  const rows = await registry.outboxRepo.listByEventType('ADMIN_ORDER_EMAIL', 100);
  const data = {
    recipientReadiness: {
      state: recipientCfg.state,
      recipients: recipientCfg.recipients.map(maskAdminEmail),
    },
    intents: rows.map((r) => ({
      id: r.id,
      orderId: r.relatedEntityId,
      event: (r.payload as any)?.event ?? null,
      preparationState: (r.payload as any)?.preparationState ?? null,
      deliveryState: deliveryStateOf(r),
      attemptCount: r.attemptCount,
      nextAttemptAt: r.nextAttemptAt.toISOString(),
      lastError: scrubMessage(r.lastError ?? null),
      dryRunOnly: r.dryRunOnly,
      createdAt: r.createdAt.toISOString(),
    })),
  };
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

// ---- Wave 2E-3: template wording overrides ------------------------------
// Draft -> publish -> revert, per template key, through the Registry repository
// (routes stay schema-free per the architecture boundary). Code strings are the
// canonical fallback; publish swaps rows atomically and the sender cache refreshes
// immediately here and every minute otherwise. All mutations audited.

routes.get('/templates', requirePermissions([PERMISSIONS.NOTIFICATIONS_READ]), async (c) => {
  const { NOTIFICATION_TEMPLATE_KEYS, NotificationTemplateRenderer } = await import('../../../../application/use-cases/notifications/NotificationTemplateRenderer');
  const renderer = new NotificationTemplateRenderer();
  const rows = await Registry.getInstance().notificationTemplateRepo.listAll();
  const templates = NOTIFICATION_TEMPLATE_KEYS.map((key) => ({
    key,
    defaults: { subject: renderer.getSubject(key), preheader: renderer.getPreheader(key) },
    draft: rows.find((r) => r.templateKey === key && r.status === 'DRAFT') ?? null,
    published: rows.find((r) => r.templateKey === key && r.status === 'PUBLISHED') ?? null,
  }));
  const res: ApiResponse<{ templates: typeof templates }> = { success: true, data: { templates } };
  return c.json(res);
});

routes.post('/templates/:key/draft', requirePermissions([PERMISSIONS.NOTIFICATIONS_MANAGE]), async (c) => {
  const { NOTIFICATION_TEMPLATE_KEYS } = await import('../../../../application/use-cases/notifications/NotificationTemplateRenderer');
  const key = c.req.param('key') ?? '';
  if (!NOTIFICATION_TEMPLATE_KEYS.includes(key as never)) {
    return c.json({ success: false, error: { code: 'UNKNOWN_TEMPLATE', message: 'Unknown template key.' } } satisfies ApiResponse<never>, 404);
  }
  const body = await c.req.json().catch(() => null);
  const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const patch = { subject: clean(body?.subject, 200), preheader: clean(body?.preheader, 300), headline: clean(body?.headline, 200) };
  if (!patch.subject && !patch.preheader && !patch.headline) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'At least one of subject/preheader/headline is required.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const row = await registry.notificationTemplateRepo.upsertDraft(key, patch, actorId);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'NOTIFICATION_TEMPLATE_DRAFTED', entity: 'notification_template', entityId: row.id, newState: { key, ...patch },
  });
  return c.json({ success: true, data: row } satisfies ApiResponse<typeof row>);
});

routes.post('/templates/:key/publish', requirePermissions([PERMISSIONS.NOTIFICATIONS_MANAGE]), async (c) => {
  const key = c.req.param('key') ?? '';
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const published = await registry.notificationTemplateRepo.publishDraft(key, actorId);
  if (!published) {
    return c.json({ success: false, error: { code: 'NO_DRAFT', message: 'Nothing to publish — create a draft first.' } } satisfies ApiResponse<never>, 409);
  }
  const { templateOverrideCache } = await import('../../../../infrastructure/notifications/TemplateOverrideCache');
  await templateOverrideCache.refresh();
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'NOTIFICATION_TEMPLATE_PUBLISHED', entity: 'notification_template', entityId: published.id,
    newState: { key, subject: published.subject, preheader: published.preheader, headline: published.headline },
  });
  return c.json({ success: true, data: published } satisfies ApiResponse<typeof published>);
});

routes.post('/templates/:key/revert', requirePermissions([PERMISSIONS.NOTIFICATIONS_MANAGE]), async (c) => {
  const key = c.req.param('key') ?? '';
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const deletedId = await registry.notificationTemplateRepo.revertPublished(key);
  if (!deletedId) {
    return c.json({ success: false, error: { code: 'NO_OVERRIDE', message: 'No published override — code defaults already apply.' } } satisfies ApiResponse<never>, 409);
  }
  const { templateOverrideCache } = await import('../../../../infrastructure/notifications/TemplateOverrideCache');
  await templateOverrideCache.refresh();
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'NOTIFICATION_TEMPLATE_REVERTED', entity: 'notification_template', entityId: deletedId,
    newState: { key, revertedToCodeDefaults: true },
  });
  return c.json({ success: true, data: { key, reverted: true } } satisfies ApiResponse<{ key: string; reverted: boolean }>);
});

routes.post('/admin-order-emails/:id/replay', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body?.reason ?? '').slice(0, 500);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().replayAdminOrderEmailUseCase.execute({ eventId: id, actorId, reason });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

export default routes;
