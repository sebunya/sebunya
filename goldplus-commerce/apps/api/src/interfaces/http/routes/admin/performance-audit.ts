import { Hono, Context } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Continuous Performance Assurance — admin API (mounted at /admin/performance-audit).
 *
 *   GET  /            overview: scheduler health, latest run, run list, request queue, provider matrix   (seo.view)
 *   GET  /runs/:id    one run: reports, every measured cell, provider statuses, alerts                    (seo.view)
 *   POST /runs        request a run { label, kind: 'ad-hoc' | 'recurring-now' }                          (seo.audit.run)
 *
 * The API never runs the audit: POST writes a request file that the host
 * watcher (performance-audit/schedule/process-requests.sh) picks up. Limits
 * (one in flight, six per day, reserved labels) are enforced in the use case.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = (c: Context, data: unknown, status = 200) => c.json({ success: true, data } as ApiResponse<unknown>, status as never);
const bad = (c: Context, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } } as ApiResponse<never>, status as never);

routes.get('/', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const data = await Registry.getInstance().getPerformanceAuditOverviewUseCase.execute();
  return ok(c, data);
});

routes.get('/runs/:id', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const run = await Registry.getInstance().getPerformanceAuditRunUseCase.execute(c.req.param('id') ?? '');
  if (!run) return bad(c, 'NOT_FOUND', 'No such audit run.', 404);
  return ok(c, run);
});

routes.post('/runs', requirePermissions([PERMISSIONS.SEO_AUDIT_RUN]), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { label?: unknown; kind?: unknown } | null;
  if (!body) return bad(c, 'BAD_INPUT', 'Expected a JSON body { label, kind }.');
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.requestPerformanceAuditRunUseCase.execute({ label: body.label, kind: body.kind, actorId });
  if (!outcome.ok) return bad(c, outcome.code, outcome.message, outcome.status);
  await registry.createAuditLogUseCase.execute({
    actorId, action: 'PERFORMANCE_AUDIT_RUN_REQUESTED', entity: 'performance_audit_request', entityId: outcome.request.id,
    newState: { label: outcome.request.label, kind: outcome.request.kind },
  });
  return ok(c, outcome.request, 202);
});

export default routes;
