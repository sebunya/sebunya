import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();
const registry = Registry.getInstance();

routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.EXPERIMENTS_MANAGE]), async (c) => {
  const experiments = await registry.listExperimentsUseCase.execute();
  const data = experiments.map((e) => ({
    id: e.id,
    key: e.key,
    name: e.name,
    hypothesis: e.hypothesis,
    targetMetric: e.targetMetric,
    status: e.status,
    variants: e.variants,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }));
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.post('/', requirePermissions([PERMISSIONS.EXPERIMENTS_MANAGE]), async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const result = await registry.createExperimentUseCase.execute({
    key: String(body.key ?? ''),
    name: String(body.name ?? ''),
    hypothesis: body.hypothesis ? String(body.hypothesis) : null,
    targetMetric: body.targetMetric ? String(body.targetMetric) : null,
    variants: Array.isArray(body.variants) ? body.variants : [],
  });

  if (!result.ok) {
    const status = result.code === 'DUPLICATE_KEY' ? 409 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: (c.get('user') as any).id,
    action: 'EXPERIMENT_CREATED',
    entity: 'experiment',
    entityId: result.experiment.id,
    newState: {
      key: result.experiment.key,
      name: result.experiment.name,
      variants: result.experiment.variants,
    },
  });

  const res: ApiResponse<{ id: string; key: string; status: string }> = {
    success: true,
    data: { id: result.experiment.id, key: result.experiment.key, status: result.experiment.status },
  };
  return c.json(res, 201);
});

routes.patch('/:key/status', requirePermissions([PERMISSIONS.EXPERIMENTS_MANAGE]), async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const keyParam = String(c.req.param('key') ?? '').toLowerCase();
  const previous = await registry.experimentRepo.findByKey(keyParam);

  const result = await registry.updateExperimentStatusUseCase.execute({
    key: keyParam,
    status: String(body.status ?? ''),
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: (c.get('user') as any).id,
    action: 'EXPERIMENT_STATUS_CHANGED',
    entity: 'experiment',
    entityId: result.experiment.id,
    previousState: { status: previous?.status },
    newState: { status: result.experiment.status },
  });

  const res: ApiResponse<{ key: string; status: string }> = {
    success: true,
    data: { key: result.experiment.key, status: result.experiment.status },
  };
  return c.json(res);
});

export default routes;
