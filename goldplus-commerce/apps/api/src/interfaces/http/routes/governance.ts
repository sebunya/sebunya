import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';
import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';
import { RequestQuoteUseCase } from '../../../application/use-cases/governance/RequestQuoteUseCase';
import { OpenSupportTicketUseCase } from '../../../application/use-cases/governance/OpenSupportTicketUseCase';
import { ReportFakeProductUseCase } from '../../../application/use-cases/governance/ReportFakeProductUseCase';
import { randomUUID } from 'node:crypto';

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
routes.get('/admin/orders', async (c) => {
  try {
    const orders = await registry.getOrderListUseCase.execute();
    return c.json({ success: true, data: orders });
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

export default routes;


