import { Hono } from 'hono';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

const routes = new Hono();
const registry = Registry.getInstance();

routes.use('*', authMiddleware);

// GET /admin/measurement/payments
routes.get('/', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const result = await registry.listPaymentMeasurementReconciliationsUseCase.execute({ offset, limit });
    
    const res: ApiResponse<any> = {
      success: true,
      data: result,
    };
    return c.json(res);
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
  }
});

// GET /admin/measurement/payments/:orderId
routes.get('/:orderId', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const orderId = c.req.param('orderId') || '';
    const reconciliation = await registry.getPaymentMeasurementReconciliationUseCase.execute(orderId);
    
    if (!reconciliation) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Reconciliation not found' } }, 404);
    }

    const res: ApiResponse<any> = {
      success: true,
      data: reconciliation,
    };
    return c.json(res);
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
  }
});

// POST /admin/measurement/payments/:orderId/retry
routes.post('/:orderId/retry', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  try {
    const orderId = c.req.param('orderId') || '';
    const result = await registry.retryPaymentMeasurementReconciliationUseCase.execute({ orderId });
    
    try {
      const auditUc = registry.createAuditLogUseCase;
      await auditUc.execute({
        action: 'MEASUREMENT_RECONCILIATION_RETRY',
        actorId: c.get('user')?.id || null,
        entity: 'payment_measurement_reconciliations',
        entityId: orderId,
        newState: { statusAfterRetry: result.status }
      });
    } catch (auditErr) {
      console.error('[API_ERROR] Audit logging failed:', auditErr);
    }
    
    const res: ApiResponse<any> = {
      success: true,
      data: result,
    };
    return c.json(res);
  } catch (err: any) {
    const status = err.message.includes('NOT_FOUND') ? 404 : 400;
    return c.json({ success: false, error: { code: 'RETRY_FAILED', message: err.message } }, status);
  }
});

export default routes;
