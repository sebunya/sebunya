import { Hono } from 'hono';
import { z } from 'zod';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { ExperimentOperationError } from '../../../../application/use-cases/experiments/ExperimentOperationsUseCase';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

// audit-exempt: definition and transition mutations audit in ExperimentOperationsUseCase;
// assignment is atomically evidenced by the dedicated immutable exposure record.

const routes = new Hono();
routes.use('*', authMiddleware);
const actor = (c: any) => (c.get('user') as any).id as string;
const variant = z.object({ key: z.string().regex(/^[a-z0-9_-]{1,40}$/i), name: z.string().trim().min(1).max(120), weightBasisPoints: z.number().int().min(1).max(9999) });
const createBody = z.object({ key: z.string().regex(/^[a-z0-9_-]{2,80}$/i), name: z.string().trim().min(1).max(160), hypothesis: z.string().trim().min(1).max(2000), primaryMetric: z.string().trim().min(1).max(120), variants: z.array(variant).min(2).max(20) });
const transitionBody = z.object({ expectedVersion: z.number().int().min(1), to: z.enum(['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'INCONCLUSIVE', 'INVALID']), reason: z.string().trim().min(3).max(1000) });
const exposureBody = z.object({ subjectKey: z.string().min(1).max(256), exposureKey: z.string().regex(/^[A-Za-z0-9._:/#-]{3,160}$/), occurredAt: z.coerce.date().optional() });
function failure(c: any, error: unknown) {
  const known = error instanceof ExperimentOperationError;
  const code = known ? error.code : 'EXPERIMENT_OPERATION_FAILED';
  const status = code === 'EXPERIMENT_NOT_FOUND' ? 404 : code === 'STALE_VERSION' || code === 'INVALID_TRANSITION' ? 409 : 400;
  return c.json({ success: false, error: { code, message: error instanceof Error ? error.message : 'Experiment operation failed.' } } satisfies ApiResponse<never>, status);
}
routes.get('/', requirePermissions([PERMISSIONS.EXPERIMENTS_READ], 'PERMISSION_DENIED'), async (c) => c.json({ success: true, data: await Registry.getInstance().experimentOperationsUseCase.list() }));
routes.post('/', requirePermissions([PERMISSIONS.EXPERIMENTS_MANAGE], 'PERMISSION_DENIED'), async (c) => {
  const body = createBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: body.error.issues[0]?.message ?? 'Invalid body.' } }, 400);
  try { return c.json({ success: true, data: await Registry.getInstance().experimentOperationsUseCase.create({ ...body.data, actorId: actor(c) }) }, 201); } catch (error) { return failure(c, error); }
});
routes.get('/:id', requirePermissions([PERMISSIONS.EXPERIMENTS_READ], 'PERMISSION_DENIED'), async (c) => { try { return c.json({ success: true, data: await Registry.getInstance().experimentOperationsUseCase.detail(String(c.req.param('id') ?? '')) }); } catch (error) { return failure(c, error); } });
routes.post('/:id/transition', requirePermissions([PERMISSIONS.EXPERIMENTS_MANAGE], 'PERMISSION_DENIED'), async (c) => {
  const body = transitionBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: body.error.issues[0]?.message ?? 'Invalid body.' } }, 400);
  try { return c.json({ success: true, data: await Registry.getInstance().experimentOperationsUseCase.transition({ id: String(c.req.param('id') ?? ''), actorId: actor(c), ...body.data }) }); } catch (error) { return failure(c, error); }
});
routes.post('/:id/exposures', requirePermissions([PERMISSIONS.EXPERIMENTS_ASSIGN], 'PERMISSION_DENIED'), async (c) => {
  const body = exposureBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: body.error.issues[0]?.message ?? 'Invalid body.' } }, 400);
  try { return c.json({ success: true, data: await Registry.getInstance().experimentOperationsUseCase.assignAndExpose({ id: String(c.req.param('id') ?? ''), ...body.data }) }); } catch (error) { return failure(c, error); }
});
export default routes;
