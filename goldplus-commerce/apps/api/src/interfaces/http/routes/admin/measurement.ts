import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';

const registry = Registry.getInstance();
const getOverviewUseCase = registry.getMeasurementOverviewUseCase;
const listDlqUseCase = registry.listMeasurementDlqUseCase;
const replayDlqUseCase = registry.replayMeasurementDlqUseCase;
const listConsentAuditUseCase = registry.listConsentAuditUseCase;
const getMatchQualityUseCase = registry.getMatchQualitySummaryUseCase;
const attributionService = registry.attributionService;
const loggerAdapter = registry.measurementLogger;

const routes = new Hono();

// All admin measurement routes require auth
routes.use('*', authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/overview — high-level dashboard metrics
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/overview', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const data = await getOverviewUseCase.execute();
    return c.json({
      success: true,
      data,
    });
  } catch (err) {
    loggerAdapter.error({ err }, '[AdminMeasurement] Overview failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/dlq — list unresolved DLQ entries
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/dlq', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const rows = await listDlqUseCase.execute(100);
    return c.json({ success: true, data: rows });
  } catch (err) {
    loggerAdapter.error({ err }, '[AdminMeasurement] DLQ list failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/measurement/dlq/:id/replay — replay a DLQ entry
// audit-exempt: Audit is handled internally by ReplayMeasurementDlqUseCase
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/dlq/:id/replay', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: 'MISSING_ID' }, 400);

  const adminUser = c.get('user');
  const actorId = adminUser?.id || 'system';

  try {
    const result = await replayDlqUseCase.execute(id, actorId);
    return c.json({ success: true, message: result.message });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') return c.json({ success: false, error: 'NOT_FOUND' }, 404);
    if (err.message === 'ALREADY_RESOLVED') return c.json({ success: false, error: 'ALREADY_RESOLVED' }, 400);

    loggerAdapter.error({ err, dlqId: id }, '[AdminMeasurement] DLQ replay failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/consent-audit — paginated consent audit trail
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/consent-audit', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const limitParam = parseInt(c.req.query('limit') || '50', 10);
    const limit = Math.min(Math.max(limitParam, 1), 200);

    const rows = await listConsentAuditUseCase.execute(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    loggerAdapter.error({ err }, '[AdminMeasurement] Consent audit list failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/match-quality — match quality summary
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/match-quality', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const days = parseInt(c.req.query('days') || '7', 10);

  try {
    const summary = await getMatchQualityUseCase.execute(days);
    return c.json({ success: true, data: summary });
  } catch (err) {
    loggerAdapter.error({ err }, '[AdminMeasurement] Match quality summary failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/attribution/:orderId — attribution for specific order
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/attribution/:orderId', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const orderId = c.req.param('orderId');
  if (!orderId) return c.json({ success: false, error: 'MISSING_ORDER_ID' }, 400);

  try {
    const report = await attributionService.getAttributionReport(orderId);
    if (!report) {
      return c.json({ success: false, error: 'NOT_FOUND' }, 404);
    }
    return c.json({ success: true, data: report });
  } catch (err) {
    loggerAdapter.error({ err, orderId }, '[AdminMeasurement] Attribution report failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// The payments router is mounted ONCE, in app.ts at '/admin/measurement/payments',
// alongside its gtm/paid-social siblings. A second mount here registered the same
// handlers at the same final path; Hono served the first registration and the inner
// one was dead weight that made ownership of the path ambiguous.

export default routes;
