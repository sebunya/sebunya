import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';
import { RequestQuoteUseCase } from '../../../application/use-cases/governance/RequestQuoteUseCase';
import { OpenSupportTicketUseCase } from '../../../application/use-cases/governance/OpenSupportTicketUseCase';
import { ReportFakeProductUseCase } from '../../../application/use-cases/governance/ReportFakeProductUseCase';
import { randomUUID } from 'node:crypto';
import { authMiddleware } from '../middleware/auth';
import { requirePermissions } from '../middleware/permissions';
import { NotificationTemplateRenderer } from '../../../application/use-cases/notifications/NotificationTemplateRenderer';
import { clientIp } from '../clientAddress';
import { canTransitionOrder } from '../../../domain/commerce/OrderStateMachine';
import type { OrderStatus } from '../../../domain/commerce/Order';
import { DealerApplicationValidationError } from '../../../application/use-cases/DealerApplicationUseCase';
import { logger } from '../../../infrastructure/logging/logger';


const routes = new Hono();
const registry = Registry.getInstance();

// ---------- Dealer applications (real persist + audit) ----------
routes.post('/dealers/apply', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const dealerId = randomUUID();
  try {
    await registry.dealerApplicationUseCase.execute({ ...body, id: dealerId });
  } catch (err) {
    const message = err instanceof DealerApplicationValidationError
      ? err.message
      : 'Could not save dealer application.';
    if (!(err instanceof DealerApplicationValidationError)) {
      logger.error({ err }, '[Governance] Dealer application failed');
    }
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_INPUT', message } };
    return c.json(res, 400);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: null,
    action: 'DEALER_APPLICATION_SUBMITTED',
    entity: 'dealer',
    entityId: dealerId,
    newState: { source: 'public_form' },
  });


  // Tell the customer we have it. SMS first (the channel that delivers), email
  // as the fallback. The body comes from CustomerMessages; never a template key.
  await registry.customerOutboxNotifier.enqueue({
    eventType: 'DEALER_APPLICATION_RECEIVED',
    template: 'DEALER_APPLICATION_RECEIVED',
    customerPhone: typeof body?.phone === 'string' ? body.phone : null,
    customerEmail: typeof body?.email === 'string' ? body.email : null,
    data: { customerName: typeof body?.customerName === 'string' ? body.customerName : (typeof body?.contactName === 'string' ? body.contactName : null), reference: dealerId },
    idempotencyKey: `ack:dealer_application:${dealerId}`,
    relatedEntity: 'dealer_application',
    relatedEntityId: dealerId,
  }).catch(() => undefined);
  const res: ApiResponse<{ dealerId: string }> = { success: true, data: { dealerId } };
  return c.json(res, 201);
});

// ---------- Quote requests (real persist + audit) ----------
routes.post('/quotes/request', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const uc = new RequestQuoteUseCase(registry.quoteRepo);
  const result = await uc.execute(body);
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: null,
    action: 'QUOTE_REQUESTED',
    entity: 'quote',
    entityId: result.quoteId,
    newState: { source: 'public_form', kind: String(body.kind ?? 'retail') },
  });


  // Tell the customer we have it. SMS first (the channel that delivers), email
  // as the fallback. The body comes from CustomerMessages; never a template key.
  await registry.customerOutboxNotifier.enqueue({
    eventType: 'QUOTE_REQUEST_RECEIVED',
    template: 'QUOTE_REQUEST_RECEIVED',
    customerPhone: typeof body?.phone === 'string' ? body.phone : null,
    customerEmail: typeof body?.email === 'string' ? body.email : null,
    data: { customerName: typeof body?.customerName === 'string' ? body.customerName : (typeof body?.contactName === 'string' ? body.contactName : null), reference: result.quoteId },
    idempotencyKey: `ack:quote_request:${result.quoteId}`,
    relatedEntity: 'quote_request',
    relatedEntityId: result.quoteId,
  }).catch(() => undefined);
  const res: ApiResponse<{ quoteId: string }> = { success: true, data: { quoteId: result.quoteId } };
  return c.json(res, 201);
});

// ---------- Support issues (real persist + audit) ----------
routes.post('/support/report-issue', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const uc = new OpenSupportTicketUseCase(registry.supportRepo);
  const result = await uc.execute(body);
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: null,
    action: 'SUPPORT_ISSUE_OPENED',
    entity: 'support_ticket',
    entityId: result.ticketId,
    newState: { source: 'public_form' },
  });


  // Tell the customer we have it. SMS first (the channel that delivers), email
  // as the fallback. The body comes from CustomerMessages; never a template key.
  await registry.customerOutboxNotifier.enqueue({
    eventType: 'SUPPORT_REQUEST_RECEIVED',
    template: 'SUPPORT_REQUEST_RECEIVED',
    customerPhone: typeof body?.phone === 'string' ? body.phone : null,
    customerEmail: typeof body?.email === 'string' ? body.email : null,
    data: { customerName: typeof body?.customerName === 'string' ? body.customerName : (typeof body?.contactName === 'string' ? body.contactName : null), reference: result.ticketId },
    idempotencyKey: `ack:support_ticket:${result.ticketId}`,
    relatedEntity: 'support_ticket',
    relatedEntityId: result.ticketId,
  }).catch(() => undefined);
  const res: ApiResponse<{ ticketId: string }> = { success: true, data: { ticketId: result.ticketId } };
  return c.json(res, 201);
});

// ---------- Fake product reports (real persist + audit) ----------
routes.post('/support/report-fake', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const uc = new ReportFakeProductUseCase(registry.fakeReportRepo);
  const result = await uc.execute(body);
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }

  // Gamification (0087): a signed-in reporter is attributable — confirmation
  // of the report later earns points. Anonymous reports stay anonymous.
  const reporterAuth = c.req.header('Authorization');
  if (reporterAuth?.startsWith('Bearer ')) {
    const verified = await registry.tokenSigner.verify(reporterAuth.slice(7).trim()).catch(() => null);
    if (verified?.subject) {
      await registry.fakeReportRepo.attributeReporter(result.reportId, verified.subject).catch(() => undefined);
    }
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: null,
    action: 'FAKE_PRODUCT_REPORTED',
    entity: 'fake_report',
    entityId: result.reportId,
    newState: { source: 'public_form', hologramCodeProvided: Boolean((body as any).hologramCode) },
  });


  // Tell the customer we have it. SMS first (the channel that delivers), email
  // as the fallback. The body comes from CustomerMessages; never a template key.
  await registry.customerOutboxNotifier.enqueue({
    eventType: 'FAKE_REPORT_RECEIVED',
    template: 'FAKE_REPORT_RECEIVED',
    customerPhone: typeof body?.reporterPhone === 'string' ? body.reporterPhone : null,
    customerEmail: typeof body?.reporterEmail === 'string' ? body.reporterEmail : null,
    data: { customerName: typeof body?.reporterName === 'string' ? body.reporterName : null, reference: result.reportId },
    idempotencyKey: `ack:fake_product_report:${result.reportId}`,
    relatedEntity: 'fake_product_report',
    relatedEntityId: result.reportId,
  }).catch(() => undefined);
  const res: ApiResponse<{ reportId: string }> = { success: true, data: { reportId: result.reportId } };
  return c.json(res, 201);
});

// ---------- Verification check (unchanged — own audit table) ----------
routes.post('/verification/check', async (c) => {
  const body = await c.req.json();
  const ip = clientIp(c);
  const ua = c.req.header('user-agent') || '';

  const result = await registry.verificationCheckUseCase.execute(body.code, ip, ua);

  // Loyalty PART J: a signed-in scan is attributable and may earn — through
  // the versioned 'verification_scan' rule, which is INACTIVE until activated.
  // Anonymous scans stay anonymous; a loyalty failure never fails the check.
  let loyaltyPoints = 0;
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const verified = await registry.tokenSigner.verify(header.slice(7).trim()).catch(() => null);
    if (verified?.subject) {
      const successful = Boolean((result as { isSuccessful?: boolean }).isSuccessful);
      const earn = await registry.earnForVerificationScanUseCase
        .execute({ userId: verified.subject, code: String(body.code ?? ''), successful })
        .catch(() => null);
      if (earn?.ok) loyaltyPoints = earn.points;
      // Gamification (0087): first successful scan = Authenticator badge;
      // scan-count missions progress. Failures never fail the check.
      if (successful) {
        await registry.gamificationRepo.awardBadgeByKey(verified.subject, 'authenticator').catch(() => undefined);
        await registry.evaluateGamificationForUserUseCase.execute({ userId: verified.subject }).catch(() => undefined);
      }
    }
  }

  const res: ApiResponse<any> = {
    success: true,
    data: { ...result, loyaltyPoints },
  };
  return c.json(res);
});

routes.use('/admin/*', authMiddleware);

// ---------- Fake-report resolution (0087: confirmation is the loyalty earn
// event — "points and a support pathway for a confirmed counterfeit report").
// Mutating loyalty liability ⇒ mutating permission + audit, like every other
// point-granting admin action. ----------
routes.patch('/admin/fake-reports/:id/status', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const status = String(body?.status ?? '');
  if (!['investigating', 'verified_fake', 'dismissed'].includes(status)) {
    return c.json({ success: false, error: { code: 'BAD_STATUS', message: 'status must be investigating, verified_fake or dismissed.' } }, 400);
  }
  const report = await registry.fakeReportRepo.findByIdRaw(c.req.param('id') ?? '');
  if (!report) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Report not found.' } }, 404);

  let loyalty: { points: number } | null = null;
  if (status === 'verified_fake' && report.reporterUserId && !report.loyaltyEntryId) {
    const earn = await registry.earnForCounterfeitConfirmationUseCase
      .execute({ reportId: report.id, reporterUserId: report.reporterUserId })
      .catch(() => null);
    if (earn && 'points' in earn) {
      loyalty = { points: earn.points };
      await registry.fakeReportRepo.setStatus(report.id, status, earn.entryId);
      // Support pathway: the confirmed reporter gets a follow-up message.
      await registry.loyaltyOutboxNotifier
        .enqueue({
          userId: report.reporterUserId,
          eventType: 'LOYALTY_POINTS_EARNED',
          idempotencyKey: `counterfeit-confirmed:${report.id}`,
          data: { points: earn.points, source: 'counterfeit_report' },
        })
        .catch(() => undefined);
    } else {
      await registry.fakeReportRepo.setStatus(report.id, status);
    }
  } else {
    await registry.fakeReportRepo.setStatus(report.id, status);
  }

  const confirmAuditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await confirmAuditUc.execute({
    actorId: (c.get('user') as { id: string }).id,
    action: 'FAKE_REPORT_STATUS_CHANGED',
    entity: 'fake_report',
    entityId: report.id,
    newState: { status, loyaltyPointsAwarded: loyalty?.points ?? 0 },
  });
  return c.json({ success: true, data: { id: report.id, status, loyalty } });
});

// ---------- Admin dashboard stats ----------
routes.get('/admin/stats', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const [productCount, dealerCount, auditCount, supportCount] = await Promise.all([
    registry.productRepo.findAll(), 
    registry.dealerRepo.findAll(),
    registry.auditRepo.findAll(),
    registry.supportRepo.findAll(),
  ]);
  
  const res: ApiResponse<any> = {
    success: true,
    data: {
      pendingProducts: productCount.filter((p: any) => p.approvalStatus === 'draft').length,
      pendingDealers: dealerCount.filter((d: any) => d.status === 'pending').length,
      activeSecurityAlerts: 0,
      dailyVerificationChecks: 0,
      supportIssues: supportCount.filter((s: any) => s.status === 'open').length,
    },
  };
  return c.json(res);
});

// Admin List Routes
routes.get('/admin/orders', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  try {
    let ordersList = await registry.orderRepo.findAll();

    const search = c.req.query('search')?.trim().toLowerCase();
    const orderStatus = c.req.query('status')?.trim().toLowerCase();
    const paymentStatus = c.req.query('paymentStatus')?.trim().toLowerCase();

    if (search) {
      ordersList = ordersList.filter(o => 
        o.orderNumber.toLowerCase().includes(search) ||
        o.id.toLowerCase().includes(search) ||
        o.customerName.toLowerCase().includes(search) ||
        o.customerPhone.toLowerCase().includes(search) ||
        (o.customerEmail && o.customerEmail.toLowerCase().includes(search))
      );
    }

    if (orderStatus) {
      ordersList = ordersList.filter(o => o.orderStatus.toLowerCase() === orderStatus);
    }

    if (paymentStatus) {
      ordersList = ordersList.filter(o => o.paymentStatus.toLowerCase() === paymentStatus);
    }

    return c.json({ success: true, data: ordersList });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

// Admin Detail Route
routes.get('/admin/orders/:id', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  try {
    const id = c.req.param('id') as string;
    const order = await registry.orderRepo.findById(id);
    if (!order) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } }, 404);
    }

    const attempts = await registry.pesapalPaymentRepo.findAttemptsByOrderId(order.id);
    const safeAttempts = attempts.map(att => ({
      id: att.id,
      merchantReference: att.merchantReference,
      orderTrackingId: att.orderTrackingId,
      amount: att.amount,
      currency: att.currency,
      status: att.status,
      redirectUrl: att.redirectUrl,
      provider: att.provider,
      ipnReceivedAt: att.ipnReceivedAt,
      callbackReceivedAt: att.callbackReceivedAt,
      createdAt: att.createdAt,
      updatedAt: att.updatedAt,
    }));

    return c.json({
      success: true,
      data: {
        order,
        paymentAttempts: safeAttempts,
      }
    });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

/**
 * Admin cart lookup.
 *
 * The storefront's admin page already sent a bearer token to `GET /commerce/carts/:id`
 * — but that route had NO permission guard, so the token was decorative and any
 * unauthenticated caller could read any cart by id. The customer-facing route is now
 * credential-scoped and cannot serve an arbitrary id at all, so the admin need moves
 * here where it can actually be authorized.
 */
routes.get('/admin/carts/:id', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const id = c.req.param('id') as string;
  // Validated before the query so a malformed id is a 400 rather than a Postgres
  // syntax error surfacing as a 500.
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    return c.json({ success: false, error: { code: 'INVALID_UUID', message: 'Cart ids are UUIDs.' } }, 400);
  }

  const record = await registry.authorizedCartRepo.find(id);
  if (!record) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Cart not found.' } }, 404);
  }

  return c.json({
    success: true,
    data: {
      id: record.id,
      version: record.version,
      // The owner KIND is useful for support ("is this a guest basket?"); the owner ID
      // is not returned, because for a USER cart it is the customer's account id and
      // this surface has no need to hand it out.
      ownerKind: record.ownerKind,
      items: record.items,
      subtotalUgx: record.items.reduce((sum, line) => sum + line.unitPriceUgx * line.quantity, 0),
    },
  });
});

// Admin Communication Preview Route
routes.get('/admin/orders/:id/communication-preview', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  try {
    const id = c.req.param('id') as string;
    const order = await registry.orderRepo.findById(id);
    if (!order) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } }, 404);
    }

    const template = c.req.query('template') as any;

    let computedTemplate = 'ORDER_RECEIVED_UNPAID';
    if (order.orderStatus === 'pending_payment') {
      computedTemplate = 'ORDER_PAYMENT_PENDING';
    } else if (order.paymentStatus === 'paid') {
      if (order.orderStatus === 'processing') {
        computedTemplate = 'ORDER_PAYMENT_SUCCESS';
      } else if (order.orderStatus === 'completed') {
        computedTemplate = 'ORDER_FULFILLMENT_COMPLETED';
      }
    } else if (order.orderStatus === 'cancelled') {
      computedTemplate = 'ORDER_PAYMENT_CANCELLED';
    } else if (order.orderStatus === 'failed') {
      computedTemplate = 'ORDER_PAYMENT_FAILED';
    } else if (order.orderStatus === 'processing') {
      computedTemplate = 'ORDER_FULFILLMENT_PROCESSING';
    }

    const targetTemplate = template || computedTemplate;
    const renderer = new NotificationTemplateRenderer();
    const emailHtml = renderer.renderEmail(targetTemplate as any, order);
    const whatsappText = renderer.renderWhatsApp(order);

    return c.json({
      success: true,
      data: {
        template: targetTemplate,
        emailHtml,
        whatsappText,
      }
    });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

// Admin Fulfillment Update Route

routes.patch('/admin/orders/:id/fulfillment', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  try {
    const id = c.req.param('id') as string;
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.status !== 'string') {
      return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Status must be a string.' } }, 400);
    }

    const nextStatus = body.status.trim().toLowerCase();
    const order = await registry.orderRepo.findById(id);
    if (!order) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } }, 404);
    }

    const currentStatus = order.orderStatus;
    const allowedStatuses = ['received', 'pending_payment', 'pending_owner_review', 'processing', 'completed', 'cancelled', 'failed'];
    
    if (!allowedStatuses.includes(nextStatus)) {
      return c.json({ success: false, error: { code: 'INVALID_STATUS', message: `Invalid fulfillment status: ${nextStatus}` } }, 400);
    }

    if (currentStatus === nextStatus) {
      return c.json({ success: true, message: `Status is already set to ${nextStatus}`, data: order });
    }

    // Enforce allowed transitions via the domain state machine (single source of
    // truth; the entity enforces the same rules, so nothing can persist an
    // illegal transition from any caller).
    const decision = canTransitionOrder(currentStatus, nextStatus as OrderStatus, { paymentStatus: order.paymentStatus });
    if (!decision.allowed) {
      return c.json({ success: false, error: { code: 'TRANSITION_BLOCKED', message: decision.message } }, 400);
    }

    // Canonical transactional transition: the status update AND exactly one
    // append-only order_event commit in one transaction. Actor is the session
    // user, never a body field. The pure domain object is kept only for the
    // response DTO; persistence goes through the canonical service.
    const updatedOrder = order.transitionStatus(nextStatus as any);
    await registry.orderTransitionService.transition(order.id, nextStatus as OrderStatus, {
      actorId: (c.get('user') as { id: string }).id,
      actorType: 'administrator',
      source: 'admin_api',
      reasonCode: 'admin_transition',
      idempotencyKey: `admin:${order.id}:${nextStatus}`,
    });

    // Audit log
    const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
    await auditUc.execute({
      actorId: (c.get('user') as any).id,
      action: 'ORDER_FULFILLMENT_TRANSITION',
      entity: 'order',
      entityId: order.id,
      newState: { status: nextStatus, previousStatus: currentStatus },
    });

    return c.json({
      success: true,
      message: `Fulfillment status transitioned to ${nextStatus}`,
      data: updatedOrder,
    });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});


routes.get('/admin/products', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  try {
    // Admin view fetches all products regardless of active state
    const products = await registry.productRepo.findAll();
    return c.json({ success: true, data: products });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

routes.get('/admin/payments', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  try {
    const payments = await registry.paymentRepo.findAll();
    return c.json({ success: true, data: payments });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

// Slice 3C: read-only reconciliation of order payment status vs payment
// records vs provider attempts. Never mutates; operators act via runbooks.
routes.get('/admin/payments/reconciliation', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  try {
    const report = await registry.getPaymentReconciliationUseCase.execute();
    return c.json({ success: true, data: report });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

routes.get('/admin/quotes', requirePermissions([PERMISSIONS.QUOTES_MANAGE]), async (c) => {
  try {
    const quotes = await registry.quoteRepo.findAll();
    return c.json({ success: true, data: quotes });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

routes.get('/admin/support', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    // Slice 11: SLA-annotated inbox, overdue first. Shape stays a flat list
    // of tickets with additive sla/assignedTo fields.
    const inbox = await registry.getSupportInboxUseCase.execute();
    const support = inbox.map(({ ticket, sla }) => ({ ...ticket, sla }));
    return c.json({ success: true, data: support });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

// Slice 9: deterministic, consent-bound lifecycle segments (read-only, no PII).
routes.get('/admin/lifecycle', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const report = await registry.getLifecycleSegmentsUseCase.execute();
    return c.json({ success: true, data: report });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

// Slice 11: inbox mutations — status transitions and assignment, audited.
routes.patch('/admin/support/:id', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } }, 400);
  }
  const result = await registry.updateSupportTicketUseCase.execute({
    ticketId: String(c.req.param('id') ?? ''),
    status: body.status !== undefined ? String(body.status) : undefined,
    assignedTo: body.assignedTo !== undefined ? (body.assignedTo === null ? null : String(body.assignedTo)) : undefined,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } }, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: (c.get('user') as any).id,
    action: 'SUPPORT_TICKET_UPDATED',
    entity: 'support_ticket',
    entityId: result.ticket.id,
    newState: { status: result.ticket.status, assignedTo: result.ticket.assignedTo },
  });
  return c.json({ success: true, data: result.ticket });
});

routes.get('/admin/dealers', requirePermissions([PERMISSIONS.DEALER_READ_PRIVATE]), async (c) => {
  try {
    const dealers = await registry.dealerRepo.findAll();
    return c.json({ success: true, data: dealers });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

export default routes;

