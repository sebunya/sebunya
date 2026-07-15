import { Hono } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { getConsentOperationsRuntime } from '../../../../infrastructure/consent/ConsentOperationsRuntime';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

type Variables = { user: { id: string; email: string; permissions: string[] } };
const routes = new Hono<{ Variables: Variables }>();

routes.use('*', authMiddleware);

routes.get('/summary', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperationsRuntime();
  const generatedAt = new Date().toISOString();
  try {
    const counters = await runtime.repository.readCounters();
    return c.json({ success: true, data: runtime.summaryService.evaluate(counters, runtime.features, generatedAt) });
  } catch {
    return c.json({
      success: false,
      error: { code: 'COUNTER_SOURCE_UNAVAILABLE', message: 'Consent operations counters are unavailable.' },
      data: runtime.summaryService.counterSourceUnavailable(runtime.features, generatedAt),
    }, 503);
  }
});

export default routes;
