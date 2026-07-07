import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { AdminUserDto } from '../../../../application/use-cases/admin/ListAdminUsersUseCase';

const routes = new Hono();
routes.use('*', authMiddleware);

function actorId(c: any): string {
  return (c.get('user') as any).id;
}

async function readJson(c: any): Promise<any | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

routes.get('/', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const useCase = Registry.getInstance().listAdminUsersUseCase;
  const data = await useCase.execute();

  const res: ApiResponse<AdminUserDto[]> = { success: true, data };
  return c.json(res);
});

routes.patch('/:id/status', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const body = await readJson(c);
  if (!body || typeof body.isActive !== 'boolean') {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'BAD_INPUT', message: 'Body must include boolean "isActive".' },
    };
    return c.json(res, 400);
  }

  const result = await registry.setUserActiveUseCase.execute({
    actorId: actorId(c),
    userId: String(c.req.param('id')),
    isActive: body.isActive,
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 409;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: actorId(c),
    action: result.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    entity: 'user',
    entityId: result.userId,
    newState: { isActive: result.isActive },
  });

  const res: ApiResponse<{ userId: string; isActive: boolean }> = { success: true, data: result };
  return c.json(res);
});

routes.post('/:id/roles', requirePermissions([PERMISSIONS.ROLES_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const body = await readJson(c);
  if (!body || !body.roleId) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_INPUT', message: 'Body must include "roleId".' } };
    return c.json(res, 400);
  }

  const result = await registry.assignUserRoleUseCase.execute({
    actorId: actorId(c),
    userId: String(c.req.param('id')),
    roleId: String(body.roleId),
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' || result.code === 'ROLE_NOT_FOUND' ? 404 : 409;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: actorId(c),
    action: 'USER_ROLE_ASSIGNED',
    entity: 'user',
    entityId: String(c.req.param('id')),
    newState: { roleId: String(body.roleId), outcome: result.outcome },
  });

  const res: ApiResponse<{ outcome: string }> = { success: true, data: { outcome: result.outcome } };
  return c.json(res);
});

routes.delete('/:id/roles/:roleId', requirePermissions([PERMISSIONS.ROLES_MANAGE]), async (c) => {
  const registry = Registry.getInstance();

  const result = await registry.removeUserRoleUseCase.execute({
    actorId: actorId(c),
    userId: String(c.req.param('id')),
    roleId: String(c.req.param('roleId')),
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' || result.code === 'ROLE_NOT_FOUND' ? 404 : 409;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: actorId(c),
    action: 'USER_ROLE_REMOVED',
    entity: 'user',
    entityId: String(c.req.param('id')),
    newState: { roleId: String(c.req.param('roleId')), outcome: result.outcome },
  });

  const res: ApiResponse<{ outcome: string }> = { success: true, data: { outcome: result.outcome } };
  return c.json(res);
});

export default routes;
