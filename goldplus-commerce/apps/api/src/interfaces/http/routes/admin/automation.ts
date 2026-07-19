import { Hono } from 'hono';
import { z } from 'zod';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { AutomationOperationError } from '../../../../application/ports/IAutomationOperationsRepository';
import { AutomationVersionConfig } from '../../../../domain/automation/Automation';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

/**
 * Automation operating surface. Mutations and audit stay in the operations use
 * case; execution delegates to the existing A3 planner/action/outbox paths.
 * No route calls a provider. audit-exempt: every POST delegates audit.
 */
// audit-exempt: every mutation delegates to AutomationOperationsUseCase, which writes the shared audit log.
const routes = new Hono<{ Variables: { user?: { id: string; email: string; permissions: string[] }; requestId?: string } }>();
routes.use('*', authMiddleware);

const actor = (c: any) => (c.get('user') as { id: string }).id;
const correlation = (c: any) => String(c.get('requestId') || c.req.header('x-correlation-id') || Registry.getInstance().automationOperationsUseCase.newCorrelationId());

function errorResponse(c: any, error: unknown) {
  if (error instanceof AutomationOperationError) {
    const status = error.code === 'AUTOMATION_NOT_FOUND' || error.code === 'VERSION_NOT_FOUND' ? 404
      : ['INVALID_TRANSITION', 'APPROVAL_REQUIRED', 'APPROVAL_EXPIRED', 'STALE_VERSION', 'REPLAY_NOT_ALLOWED', 'RECONCILIATION_NOT_ALLOWED', 'OUTCOME_NOT_AMBIGUOUS'].includes(error.code) ? 409
      : 400;
    return c.json({ success: false, error: { code: error.code, message: error.message } } satisfies ApiResponse<never>, status);
  }
  throw error;
}

const paging = z.object({
  status: z.string().trim().max(40).optional(),
  definitionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParams = z.object({ id: z.string().uuid() });
const transitionBody = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(1).max(1000).nullable().optional() });
const scheduleSchema = z.object({
  timezone: z.string().trim().min(1).max(80),
  intervalMinutes: z.number().int().positive(),
  effectiveStart: z.coerce.date().nullable(),
  effectiveEnd: z.coerce.date().nullable(),
  misfirePolicy: z.enum(['SKIP', 'RUN_ONCE']),
});
const configSchema = z.object({
  triggerFamily: z.enum(['DOMAIN_EVENT', 'SCHEDULED', 'DECISION_RECOMMENDATION', 'CUSTOMER_STATE_CHANGE', 'MANUAL_ADMIN']),
  triggerRef: z.string().trim().max(160).nullable(),
  audiencePolicyMode: z.enum(['SNAPSHOT_AT_PLAN', 'REEVALUATE_AT_EXECUTION']),
  conditions: z.array(z.object({ conditionId: z.string().trim().min(1).max(100), category: z.string().trim().min(1).max(60), operator: z.string().trim().min(1).max(40), expected: z.unknown() })).max(50),
  actions: z.array(z.object({ actionIndex: z.number().int().min(0), family: z.enum(['INTERNAL_NOTIFICATION', 'CREATE_ADMIN_TASK', 'CREATE_FULFILMENT_TASK', 'CREATE_SUPPORT_TASK', 'EMAIL', 'WHATSAPP_TEMPLATE', 'ANALYTICS_EVENT', 'NO_ACTION']), channel: z.string().trim().max(40).nullable(), config: z.record(z.string(), z.unknown()) })).min(1).max(50),
  schedule: scheduleSchema.nullable(),
  frequency: z.object({ perCustomerPerWindow: z.number().int().positive().nullable(), windowDays: z.number().int().positive().nullable(), global: z.boolean(), countsAttempts: z.boolean() }).nullable(),
});

routes.get('/overview', requirePermissions([PERMISSIONS.AUTOMATION_READ], 'PERMISSION_DENIED'), async (c) => {
  const data = await Registry.getInstance().automationOperationsUseCase.overview();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.get('/definitions', requirePermissions([PERMISSIONS.AUTOMATION_READ], 'PERMISSION_DENIED'), async (c) => {
  const parsed = paging.safeParse({ status: c.req.query('status'), limit: c.req.query('limit'), offset: c.req.query('offset') });
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' } } satisfies ApiResponse<never>, 400);
  const data = await Registry.getInstance().automationOperationsUseCase.definitions(parsed.data);
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/definitions', requirePermissions([PERMISSIONS.AUTOMATION_CREATE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(4000).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  const data = await Registry.getInstance().automationOperationsUseCase.createDefinition({ ...parsed.data, description: parsed.data.description ?? null, actorId: actor(c) });
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>, 201);
});

routes.get('/definitions/:id', requirePermissions([PERMISSIONS.AUTOMATION_READ], 'PERMISSION_DENIED'), async (c) => {
  const parsed = idParams.safeParse(c.req.param());
  if (!parsed.success) return c.json({ success: false, error: { code: 'AUTOMATION_NOT_FOUND', message: 'Automation definition was not found.' } } satisfies ApiResponse<never>, 404);
  const data = await Registry.getInstance().automationOperationsUseCase.definition(parsed.data.id);
  if (!data) return c.json({ success: false, error: { code: 'AUTOMATION_NOT_FOUND', message: 'Automation definition was not found.' } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/definitions/:id/versions', requirePermissions([PERMISSIONS.AUTOMATION_MANAGE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = z.object({ expectedVersion: z.number().int().min(0), config: configSchema }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid version.' } } satisfies ApiResponse<never>, 400);
  try {
    const data = await Registry.getInstance().automationOperationsUseCase.createVersion({ definitionId: String(c.req.param('id')), expectedVersion: parsed.data.expectedVersion, config: parsed.data.config as AutomationVersionConfig, actorId: actor(c) });
    return c.json({ success: true, data } satisfies ApiResponse<typeof data>, 201);
  } catch (error) { return errorResponse(c, error); }
});

routes.post('/definitions/:id/submit', requirePermissions([PERMISSIONS.AUTOMATION_MANAGE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = z.object({ expectedVersion: z.number().int().min(1), expiresAt: z.coerce.date().nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid submission.' } } satisfies ApiResponse<never>, 400);
  try { await Registry.getInstance().automationOperationsUseCase.submit({ definitionId: String(c.req.param('id')), expectedVersion: parsed.data.expectedVersion, expiresAt: parsed.data.expiresAt ?? null, actorId: actor(c) }); return c.json({ success: true, data: { status: 'PENDING_APPROVAL' } }); }
  catch (error) { return errorResponse(c, error); }
});

for (const decision of ['approve', 'reject'] as const) {
  routes.post(`/definitions/:id/${decision}`, requirePermissions([PERMISSIONS.AUTOMATION_APPROVE], 'PERMISSION_DENIED'), async (c) => {
    const parsed = z.object({ versionId: z.string().uuid(), expectedVersion: z.number().int().min(1), reason: z.string().trim().min(1).max(1000).nullable().optional(), expiresAt: z.coerce.date().nullable().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid decision.' } } satisfies ApiResponse<never>, 400);
    try { await Registry.getInstance().automationOperationsUseCase.decide({ definitionId: String(c.req.param('id')), ...parsed.data, reason: parsed.data.reason ?? null, expiresAt: parsed.data.expiresAt ?? null, decision: decision === 'approve' ? 'APPROVED' : 'REJECTED', actorId: actor(c) }); return c.json({ success: true, data: { status: decision === 'approve' ? 'APPROVED' : 'REJECTED' } }); }
    catch (error) { return errorResponse(c, error); }
  });
}

for (const transition of ['activate', 'pause', 'resume', 'archive'] as const) {
  routes.post(`/definitions/:id/${transition}`, requirePermissions([PERMISSIONS.AUTOMATION_MANAGE], 'PERMISSION_DENIED'), async (c) => {
    const parsed = transitionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid transition.' } } satisfies ApiResponse<never>, 400);
    try { const to = transition === 'pause' ? 'PAUSED' : transition === 'archive' ? 'ARCHIVED' : 'ACTIVE'; await Registry.getInstance().automationOperationsUseCase.transition({ definitionId: String(c.req.param('id')), ...parsed.data, reason: parsed.data.reason ?? null, to, actorId: actor(c) }); return c.json({ success: true, data: { status: to } }); }
    catch (error) { return errorResponse(c, error); }
  });
}

const controlledBody = z.object({ subjectId: z.string().trim().min(1).max(128).nullable().optional() });
routes.post('/definitions/:id/dry-run', requirePermissions([PERMISSIONS.AUTOMATION_EXECUTE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = controlledBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid dry-run request.' } } satisfies ApiResponse<never>, 400);
  try { const data = await Registry.getInstance().automationOperationsUseCase.dryRun({ definitionId: String(c.req.param('id')), subjectId: parsed.data.subjectId ?? null, actorId: actor(c), correlationId: correlation(c) }); return c.json({ success: true, data } satisfies ApiResponse<typeof data>); }
  catch (error) { return errorResponse(c, error); }
});

routes.post('/definitions/:id/execute', requirePermissions([PERMISSIONS.AUTOMATION_EXECUTE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = z.object({ subjectId: z.string().trim().min(1).max(128) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'subjectId is required.' } } satisfies ApiResponse<never>, 400);
  try {
    const data = await Registry.getInstance().automationOperationsUseCase.manualExecute({ definitionId: String(c.req.param('id')), subjectId: parsed.data.subjectId, actorId: actor(c), correlationId: correlation(c) });
    if (!data.ok) return c.json({ success: false, error: { code: data.code, message: `Execution was blocked by ${data.code}.` }, data } as any, 409);
    return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
  } catch (error) { return errorResponse(c, error); }
});

routes.get('/executions', requirePermissions([PERMISSIONS.AUTOMATION_READ], 'PERMISSION_DENIED'), async (c) => {
  const parsed = paging.safeParse({ status: c.req.query('status'), definitionId: c.req.query('definitionId'), limit: c.req.query('limit'), offset: c.req.query('offset') });
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' } } satisfies ApiResponse<never>, 400);
  const data = await Registry.getInstance().automationOperationsUseCase.executions(parsed.data);
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.get('/executions/:id', requirePermissions([PERMISSIONS.AUTOMATION_READ], 'PERMISSION_DENIED'), async (c) => {
  const data = await Registry.getInstance().automationOperationsUseCase.execution(String(c.req.param('id')));
  if (!data) return c.json({ success: false, error: { code: 'AUTOMATION_NOT_FOUND', message: 'Automation execution was not found.' } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/executions/:id/replay', requirePermissions([PERMISSIONS.AUTOMATION_REPLAY], 'PERMISSION_DENIED'), async (c) => {
  const parsed = z.object({ actionExecutionId: z.string().uuid(), reason: z.string().trim().min(1).max(1000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'Action and reason are required.' } } satisfies ApiResponse<never>, 400);
  try { const data = await Registry.getInstance().automationOperationsUseCase.replay({ ...parsed.data, actorId: actor(c), correlationId: correlation(c) }); return c.json({ success: true, data } satisfies ApiResponse<typeof data>); }
  catch (error) { return errorResponse(c, error); }
});

routes.post('/executions/:id/reconcile', requirePermissions([PERMISSIONS.AUTOMATION_RECONCILE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = z.object({ actionExecutionId: z.string().uuid(), resolution: z.enum(['SENT', 'FAILED']), reason: z.string().trim().min(1).max(1000), evidence: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,255}$/, 'Use a bounded evidence reference; do not paste provider secrets or PII.') }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'RECONCILIATION_EVIDENCE_REQUIRED', message: parsed.error.issues[0]?.message ?? 'Reconciliation evidence is required.' } } satisfies ApiResponse<never>, 400);
  try { const data = await Registry.getInstance().automationOperationsUseCase.reconcile({ ...parsed.data, actorId: actor(c), correlationId: correlation(c) }); return c.json({ success: true, data } satisfies ApiResponse<typeof data>); }
  catch (error) { return errorResponse(c, error); }
});

export default routes;
