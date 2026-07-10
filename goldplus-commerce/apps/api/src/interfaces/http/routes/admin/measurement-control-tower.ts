import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';

const registry = Registry.getInstance();
const getSummaryUseCase = registry.getMeasurementControlTowerSummaryUseCase;
const getSectionUseCase = registry.getMeasurementControlTowerSectionUseCase;
const listWarningsUseCase = registry.listMeasurementControlTowerWarningsUseCase;
const listEventsUseCase = registry.listRecentMeasurementEventsUseCase;
const recordViewUseCase = registry.recordMeasurementControlTowerViewUseCase;

const routes = new Hono();

// Auth is required for all admin routes
routes.use('*', authMiddleware);

routes.get('/summary', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const adminUser = c.get('user');
    if (!adminUser) return c.json({ success: false, error: 'UNAUTHORIZED' }, 401);
    const data = await getSummaryUseCase.execute(adminUser.id, adminUser.permissions || []);
    return c.json({ success: true, data });
  } catch (err: any) {
    if (err.message === 'ACCESS_DENIED') return c.json({ success: false, error: 'ACCESS_DENIED' }, 403);
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

routes.get('/sections/:sectionKey', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const sectionKey = c.req.param('sectionKey') || '';
  try {
    const adminUser = c.get('user');
    if (!adminUser) return c.json({ success: false, error: 'UNAUTHORIZED' }, 401);
    const data = await getSectionUseCase.execute(adminUser.id, adminUser.permissions || [], sectionKey);
    return c.json({ success: true, data });
  } catch (err: any) {
    if (err.message === 'ACCESS_DENIED') return c.json({ success: false, error: 'ACCESS_DENIED' }, 403);
    if (err.message === 'INVALID_SECTION') return c.json({ success: false, error: 'INVALID_SECTION' }, 400);
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

routes.get('/warnings', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const adminUser = c.get('user');
    if (!adminUser) return c.json({ success: false, error: 'UNAUTHORIZED' }, 401);
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const data = await listWarningsUseCase.execute(adminUser.id, adminUser.permissions || [], limit);
    return c.json({ success: true, data });
  } catch (err: any) {
    if (err.message === 'ACCESS_DENIED') return c.json({ success: false, error: 'ACCESS_DENIED' }, 403);
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

routes.get('/events', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const adminUser = c.get('user');
    if (!adminUser) return c.json({ success: false, error: 'UNAUTHORIZED' }, 401);
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const data = await listEventsUseCase.execute(adminUser.id, adminUser.permissions || [], limit);
    return c.json({ success: true, data });
  } catch (err: any) {
    if (err.message === 'ACCESS_DENIED') return c.json({ success: false, error: 'ACCESS_DENIED' }, 403);
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// audit-exempt: view audits handled by domain specific audit repo (Measurement Control Tower tracking views natively)
routes.post('/viewed', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const adminUser = c.get('user');
    if (!adminUser) return c.json({ success: false, error: 'UNAUTHORIZED' }, 401);
    const body = await c.req.json().catch(() => ({}));
    await recordViewUseCase.execute(adminUser.id, adminUser.permissions || [], body.sectionKey);
    return c.json({ success: true });
  } catch (err: any) {
    if (err.message === 'ACCESS_DENIED') return c.json({ success: false, error: 'ACCESS_DENIED' }, 403);
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

export default routes;
