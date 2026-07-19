import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Decision Intelligence admin surface. Read is decision_intelligence.read;
 * evaluation/recompute is decision_intelligence.evaluate; assignment is
 * decision_intelligence.assign; workflow mutations are decision_intelligence.manage.
 * Deny-by-default; every mutation audits in its use case.
 *
 * audit-exempt: evaluate, acknowledge, assign, start, resolve, dismiss and
 * recompute delegate auditing to their use cases (CreateAuditLogUseCase).
 */
const routes = new Hono();
routes.use('*', authMiddleware);

function errStatus(code: string): 400 | 404 | 409 {
  if (code === 'INSIGHT_NOT_FOUND') return 404;
  if (code === 'STALE_INSIGHT_VERSION' || code === 'INVALID_TRANSITION') return 409;
  return 400;
}
const actor = (c: any) => (c.get('user') as any).id as string;

routes.get('/overview', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_READ]), async (c) => {
  const overview = await Registry.getInstance().getDecisionOverviewUseCase.execute();
  return c.json({ success: true, data: overview } satisfies ApiResponse<typeof overview>);
});

const listQ = z.object({
  category: z.string().max(20).optional(), severity: z.string().max(12).optional(), confidence: z.string().max(24).optional(),
  status: z.string().max(16).optional(), assignedTo: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(), offset: z.coerce.number().int().min(0).optional(),
});
routes.get('/insights', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_READ]), async (c) => {
  const p = listQ.safeParse({ category: c.req.query('category'), severity: c.req.query('severity'), confidence: c.req.query('confidence'), status: c.req.query('status'), assignedTo: c.req.query('assignedTo'), limit: c.req.query('limit'), offset: c.req.query('offset') });
  if (!p.success) return c.json({ success: false, error: { code: 'INVALID_QUERY', message: p.error.issues[0]?.message ?? 'Invalid query.' } } satisfies ApiResponse<never>, 400);
  const result = await Registry.getInstance().listDecisionInsightsUseCase.execute({ ...p.data, limit: p.data.limit ?? 25, offset: p.data.offset ?? 0 });
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

routes.get('/insights/:id', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_READ]), async (c) => {
  const result = await Registry.getInstance().getDecisionInsightUseCase.execute(String(c.req.param('id') ?? ''));
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, errStatus(result.code));
  return c.json({ success: true, data: result.detail } satisfies ApiResponse<typeof result.detail>);
});

routes.post('/evaluate', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_EVALUATE]), async (c) => {
  const result = await Registry.getInstance().evaluateDecisionSignalsBatchUseCase.execute({ actorId: actor(c) });
  return c.json({ success: true, data: result.result } satisfies ApiResponse<typeof result.result>);
});

const versionBody = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().max(1000).optional() });
const assignBody = versionBody.extend({ assignedTo: z.string().uuid().nullable().optional(), assignedTeam: z.string().max(64).nullable().optional() });
const resolveBody = versionBody.extend({ resolutionCode: z.enum(['ACTION_COMPLETED', 'FALSE_POSITIVE', 'EXPECTED_VARIATION', 'DATA_QUALITY_ISSUE', 'DEPENDENCY_BLOCKED', 'NO_ACTION_REQUIRED']) });

async function runTransition(c: any, toStatus: any, eventType: string, extra: Record<string, unknown> = {}) {
  const id = String(c.req.param('id') ?? '');
  const result = await Registry.getInstance().transitionDecisionInsightUseCase.execute({ id, actorId: actor(c), toStatus, eventType, ...(extra as any) });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, errStatus(result.code));
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
}

routes.post('/insights/:id/acknowledge', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_MANAGE]), async (c) => {
  const p = versionBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'expectedVersion required.' } } satisfies ApiResponse<never>, 400);
  return runTransition(c, 'ACKNOWLEDGED', 'ACKNOWLEDGE', { expectedVersion: p.data.expectedVersion, reason: p.data.reason });
});
routes.post('/insights/:id/assign', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_ASSIGN]), async (c) => {
  const p = assignBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: p.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  return runTransition(c, 'ASSIGNED', 'ASSIGN', { expectedVersion: p.data.expectedVersion, reason: p.data.reason, assignedTo: p.data.assignedTo ?? null, assignedTeam: p.data.assignedTeam ?? null });
});
routes.post('/insights/:id/start', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_MANAGE]), async (c) => {
  const p = versionBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'expectedVersion required.' } } satisfies ApiResponse<never>, 400);
  return runTransition(c, 'IN_PROGRESS', 'START', { expectedVersion: p.data.expectedVersion, reason: p.data.reason });
});
routes.post('/insights/:id/resolve', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_MANAGE]), async (c) => {
  const p = resolveBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: p.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  return runTransition(c, 'RESOLVED', 'RESOLVE', { expectedVersion: p.data.expectedVersion, reason: p.data.reason, resolutionCode: p.data.resolutionCode });
});
routes.post('/insights/:id/dismiss', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_MANAGE]), async (c) => {
  const p = resolveBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: p.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  return runTransition(c, 'DISMISSED', 'DISMISS', { expectedVersion: p.data.expectedVersion, reason: p.data.reason, resolutionCode: p.data.resolutionCode });
});
routes.post('/insights/:id/recompute', requirePermissions([PERMISSIONS.DECISION_INTELLIGENCE_EVALUATE]), async (c) => {
  const result = await Registry.getInstance().recomputeDecisionInsightUseCase.execute({ id: String(c.req.param('id') ?? ''), actorId: actor(c) });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, errStatus(result.code));
  return c.json({ success: true, data: result.result } satisfies ApiResponse<typeof result.result>);
});

export default routes;
