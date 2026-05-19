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
    const message = err instanceof Error ? err.message : 'Could not save dealer application.';
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

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: null,
    action: 'FAKE_PRODUCT_REPORTED',
    entity: 'fake_report',
    entityId: result.reportId,
    newState: { source: 'public_form', hologramCodeProvided: Boolean((body as any).hologramCode) },
  });

  const res: ApiResponse<{ reportId: string }> = { success: true, data: { reportId: result.reportId } };
  return c.json(res, 201);
});

// ---------- Verification check (unchanged — own audit table) ----------
routes.post('/verification/check', async (c) => {
  const body = await c.req.json();
  const ip = c.req.header('x-forwarded-for') || '';
  const ua = c.req.header('user-agent') || '';
  
  const result = await registry.verificationCheckUseCase.execute(body.code, ip, ua);
  
  const res: ApiResponse<any> = {
    success: true,
    data: result,
  };
  return c.json(res);
});

// ---------- Admin dashboard stats (unchanged) ----------
routes.get('/admin/stats', async (c) => {
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
routes.get('/admin/orders', authMiddleware, requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
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
routes.get('/admin/orders/:id', authMiddleware, requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
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

// Admin Communication Preview Route
routes.get('/admin/orders/:id/communication-preview', authMiddleware, requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
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

routes.patch('/admin/orders/:id/fulfillment', authMiddleware, requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
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

    // Enforce allowed transitions
    let allowed = false;
    
    if (currentStatus === 'received') {
      if (nextStatus === 'processing' || nextStatus === 'cancelled') allowed = true;
    } else if (currentStatus === 'pending_payment') {
      if (nextStatus === 'cancelled') {
        allowed = true;
      } else if (nextStatus === 'processing') {
        if (order.paymentStatus === 'paid') {
          allowed = true;
        } else {
          return c.json({ 
            success: false, 
            error: { 
              code: 'TRANSITION_BLOCKED', 
              message: 'Cannot process an unpaid order that is pending payment.' 
            } 
          }, 400);
        }
      }
    } else if (currentStatus === 'pending_owner_review') {
      if (nextStatus === 'processing' || nextStatus === 'cancelled') allowed = true;
    } else if (currentStatus === 'processing') {
      if (nextStatus === 'completed' || nextStatus === 'cancelled') allowed = true;
    }

    if (!allowed) {
      return c.json({ 
        success: false, 
        error: { 
          code: 'TRANSITION_BLOCKED', 
          message: `Operational transition from '${currentStatus}' to '${nextStatus}' is not allowed.` 
        } 
      }, 400);
    }

    // Mutate state using domain model
    const updatedOrder = order.transitionStatus(nextStatus as any);
    await registry.orderRepo.save(updatedOrder);

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


routes.get('/admin/products', async (c) => {
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

routes.get('/admin/payments', async (c) => {
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

routes.get('/admin/quotes', async (c) => {
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

routes.get('/admin/support', async (c) => {
  try {
    const support = await registry.supportRepo.findAll();
    return c.json({ success: true, data: support });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured.' } }, 503);
    }
    throw err;
  }
});

routes.get('/admin/dealers', async (c) => {
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


