import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();
const registry = Registry.getInstance();

routes.use('*', authMiddleware);

function actorId(c: any): string {
  return (c.get('user') as any).id;
}
async function readJson(c: any): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
async function audit(actor: string, action: string, entityId: string, newState?: Record<string, unknown>) {
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: actor, action, entity: 'recommendation', entityId, newState });
}
function fail(c: any, code: string, message: string, status = 400) {
  return c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status as any);
}

// ---------------- Dashboard & analytics ----------------
routes.get('/dashboard', requirePermissions([PERMISSIONS.RECS_VIEW_ANALYTICS]), async (c) => {
  const days = parseInt(c.req.query('days') ?? '30', 10);
  const data = await registry.getRecommendationDashboardUseCase.execute({ days: Number.isNaN(days) ? 30 : days });
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

// ---------------- Surface configs (draft/publish/rollback) ----------------
routes.get('/surfaces', requirePermissions([PERMISSIONS.RECS_VIEW]), async (c) => {
  const data = await registry.listSurfaceConfigsUseCase.execute();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/surfaces', requirePermissions([PERMISSIONS.RECS_MANAGE_SURFACES]), async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 'BAD_JSON', 'Request body must be JSON.');
  const result = await registry.saveSurfaceConfigDraftUseCase.execute(body, actorId(c));
  if (!result.ok) return fail(c, result.code, result.message);
  await audit(actorId(c), 'RECS_SURFACE_DRAFT_SAVED', result.config.id, { surface: result.config.surface, status: result.config.status });
  return c.json({ success: true, data: result.config });
});

routes.post('/surfaces/:surface/publish', requirePermissions([PERMISSIONS.RECS_PUBLISH]), async (c) => {
  const result = await registry.publishSurfaceConfigUseCase.execute(c.req.param('surface') as any, actorId(c));
  if (!result.ok) return fail(c, result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400);
  await audit(actorId(c), 'RECS_SURFACE_PUBLISHED', result.config.id, { surface: result.config.surface, version: result.config.version });
  return c.json({ success: true, data: result.config });
});

routes.get('/surfaces/:surface/versions', requirePermissions([PERMISSIONS.RECS_VIEW]), async (c) => {
  const data = await registry.listSurfaceConfigVersionsUseCase.execute(c.req.param('surface') as any);
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/surfaces/:surface/rollback/:version', requirePermissions([PERMISSIONS.RECS_PUBLISH]), async (c) => {
  const version = parseInt(String(c.req.param('version')), 10);
  if (Number.isNaN(version)) return fail(c, 'BAD_VERSION', 'Version must be a number.');
  const result = await registry.rollbackSurfaceConfigUseCase.execute(c.req.param('surface') as any, version, actorId(c));
  if (!result.ok) return fail(c, result.code, result.message, 404);
  await audit(actorId(c), 'RECS_SURFACE_ROLLED_BACK', result.config.id, { surface: result.config.surface, toVersion: version });
  return c.json({ success: true, data: result.config });
});

// ---------------- Merchandising rules ----------------
routes.get('/rules', requirePermissions([PERMISSIONS.RECS_VIEW]), async (c) => {
  const data = await registry.listMerchandisingRulesUseCase.execute();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/rules', requirePermissions([PERMISSIONS.RECS_MANAGE_MERCHANDISING]), async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 'BAD_JSON', 'Request body must be JSON.');
  const result = await registry.createMerchandisingRuleUseCase.execute(body, actorId(c));
  if (!result.ok) return fail(c, result.code, result.message);
  await audit(actorId(c), 'RECS_RULE_CREATED', result.rule.id, { action: result.rule.action, scope: result.rule.scope, productId: result.rule.productId });
  return c.json({ success: true, data: result.rule }, 201);
});

routes.patch('/rules/:id', requirePermissions([PERMISSIONS.RECS_MANAGE_MERCHANDISING]), async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 'BAD_JSON', 'Request body must be JSON.');
  const result = await registry.updateMerchandisingRuleUseCase.execute(String(c.req.param('id')), body, actorId(c));
  if (!result.ok) return fail(c, result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400);
  await audit(actorId(c), 'RECS_RULE_UPDATED', result.rule.id, { action: result.rule.action, enabled: result.rule.enabled });
  return c.json({ success: true, data: result.rule });
});

routes.delete('/rules/:id', requirePermissions([PERMISSIONS.RECS_MANAGE_MERCHANDISING]), async (c) => {
  const id = String(c.req.param('id'));
  const result = await registry.deleteMerchandisingRuleUseCase.execute(id);
  if (!result.ok) return fail(c, 'NOT_FOUND', 'Rule not found.', 404);
  await audit(actorId(c), 'RECS_RULE_DELETED', id);
  return c.json({ success: true, data: { deleted: true } });
});

// ---------------- Compatibility rules ----------------
routes.get('/compatibility', requirePermissions([PERMISSIONS.RECS_VIEW]), async (c) => {
  const data = await registry.listCompatibilityRulesUseCase.execute();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/compatibility', requirePermissions([PERMISSIONS.RECS_MANAGE_COMPATIBILITY]), async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 'BAD_JSON', 'Request body must be JSON.');
  const result = await registry.createCompatibilityRuleUseCase.execute(body, actorId(c));
  if (!result.ok) return fail(c, result.code, result.message);
  await audit(actorId(c), 'RECS_COMPAT_CREATED', result.rule.id, { relationship: result.rule.relationship });
  return c.json({ success: true, data: result.rule }, 201);
});

routes.patch('/compatibility/:id', requirePermissions([PERMISSIONS.RECS_MANAGE_COMPATIBILITY]), async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 'BAD_JSON', 'Request body must be JSON.');
  const result = await registry.updateCompatibilityRuleUseCase.execute(String(c.req.param('id')), body);
  if (!result.ok) return fail(c, result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400);
  await audit(actorId(c), 'RECS_COMPAT_UPDATED', result.rule.id);
  return c.json({ success: true, data: result.rule });
});

routes.delete('/compatibility/:id', requirePermissions([PERMISSIONS.RECS_MANAGE_COMPATIBILITY]), async (c) => {
  const id = String(c.req.param('id'));
  const result = await registry.deleteCompatibilityRuleUseCase.execute(id);
  if (!result.ok) return fail(c, 'NOT_FOUND', 'Rule not found.', 404);
  await audit(actorId(c), 'RECS_COMPAT_DELETED', id);
  return c.json({ success: true, data: { deleted: true } });
});

// ---------------- Preview / "why" simulator ----------------
routes.post('/preview', requirePermissions([PERMISSIONS.RECS_VIEW]), async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 'BAD_JSON', 'Request body must be JSON.');
  const result = await registry.previewRecommendationsUseCase.execute({
    surface: String(body.surface ?? '') as any,
    productId: String(body.productId ?? ''),
    limit: body.limit ? Number(body.limit) : undefined,
  });
  if (!result.ok) return fail(c, result.code, result.message);
  return c.json({ success: true, data: result });
});

export default routes;
