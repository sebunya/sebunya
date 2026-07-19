import { Hono } from 'hono';
import { z } from 'zod';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { FraudTriageOperationError } from '../../../../application/use-cases/fraud/FraudTriageOperationsUseCase';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

// audit-exempt: all writes append immutable fraud_case_events inside the same database transaction.
// This router is administrator-only and has no checkout, order, payment or provider dependency.
const routes = new Hono();
routes.use('*', authMiddleware);
const actor = (c: any) => (c.get('user') as any).id as string;
const scalar = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
const evidence = z.record(z.string().regex(/^[A-Za-z0-9._:/#-]{1,80}$/), scalar).refine((value) => Object.keys(value).length <= 30, 'At most 30 evidence fields are allowed.');
const signalBody = z.object({
  referenceKey: z.string().regex(/^[A-Za-z0-9._:/#-]{1,160}$/), signalKey: z.string().regex(/^[A-Za-z0-9._:/#-]{1,160}$/),
  sourceType: z.enum(['CHECKOUT', 'ORDER', 'PAYMENT', 'IDENTITY']), sourceRef: z.string().regex(/^[A-Za-z0-9._:/#-]{1,160}$/),
  subjectRefHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), signalType: z.string().regex(/^[A-Za-z0-9._:/#-]{1,80}$/),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), reasonCode: z.string().regex(/^[A-Za-z0-9._:/#-]{1,80}$/), evidence,
});
const assignBody = z.object({ expectedVersion: z.number().int().positive(), assigneeId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) });
const decisionBody = z.object({ expectedVersion: z.number().int().positive(), decision: z.enum(['ALLOW', 'REVIEW', 'HOLD', 'DECLINE']), reason: z.string().trim().min(3).max(2000), evidence });

function invalid(c: any, issues: any) { return c.json({ success: false, error: { code: 'INVALID_BODY', message: issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>, 400); }
function failure(c: any, error: unknown) {
  const known = error instanceof FraudTriageOperationError;
  const code = known ? error.code : 'FRAUD_OPERATION_FAILED';
  const status = code === 'FRAUD_CASE_NOT_FOUND' ? 404 : ['STALE_VERSION', 'CASE_RESOLVED'].includes(code) ? 409 : 400;
  return c.json({ success: false, error: { code, message: error instanceof Error ? error.message : 'Fraud triage operation failed.' } } satisfies ApiResponse<never>, status);
}

routes.get('/overview', requirePermissions([PERMISSIONS.FRAUD_READ], 'PERMISSION_DENIED'), async (c) => c.json({ success: true, data: await Registry.getInstance().fraudTriageOperationsUseCase.overview() }));
routes.get('/cases', requirePermissions([PERMISSIONS.FRAUD_READ], 'PERMISSION_DENIED'), async (c) => {
  const status = c.req.query('status') as any; const assignedTo = c.req.query('assignedTo');
  try { return c.json({ success: true, data: await Registry.getInstance().fraudTriageOperationsUseCase.list({ status, assignedTo }) }); } catch (error) { return failure(c, error); }
});
routes.get('/cases/:id', requirePermissions([PERMISSIONS.FRAUD_READ], 'PERMISSION_DENIED'), async (c) => { try { return c.json({ success: true, data: await Registry.getInstance().fraudTriageOperationsUseCase.detail(String(c.req.param('id') ?? '')) }); } catch (error) { return failure(c, error); } });
routes.post('/signals', requirePermissions([PERMISSIONS.FRAUD_SIGNAL], 'PERMISSION_DENIED'), async (c) => {
  const body = signalBody.safeParse(await c.req.json().catch(() => null)); if (!body.success) return invalid(c, body.error.issues);
  try { return c.json({ success: true, data: await Registry.getInstance().fraudTriageOperationsUseCase.recordSignal({ ...body.data, actorId: actor(c) }) }, 201); } catch (error) { return failure(c, error); }
});
routes.post('/cases/:id/assign', requirePermissions([PERMISSIONS.FRAUD_ASSIGN], 'PERMISSION_DENIED'), async (c) => {
  const body = assignBody.safeParse(await c.req.json().catch(() => null)); if (!body.success) return invalid(c, body.error.issues);
  try { return c.json({ success: true, data: await Registry.getInstance().fraudTriageOperationsUseCase.assign({ id: String(c.req.param('id') ?? ''), actorId: actor(c), ...body.data }) }); } catch (error) { return failure(c, error); }
});
routes.post('/cases/:id/decision', requirePermissions([PERMISSIONS.FRAUD_DECIDE], 'PERMISSION_DENIED'), async (c) => {
  const body = decisionBody.safeParse(await c.req.json().catch(() => null)); if (!body.success) return invalid(c, body.error.issues);
  try { return c.json({ success: true, data: await Registry.getInstance().fraudTriageOperationsUseCase.decide({ id: String(c.req.param('id') ?? ''), actorId: actor(c), ...body.data }) }); } catch (error) { return failure(c, error); }
});
export default routes;
