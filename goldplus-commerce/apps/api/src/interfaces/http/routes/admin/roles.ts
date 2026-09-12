import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { AdminRoleDto } from '../../../../application/use-cases/admin/ListAdminRolesUseCase';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';

const routes = new Hono();
routes.use('*', authMiddleware);

type RoleListItem = AdminRoleDto & { description: string | null; isSystem: boolean };

routes.get('/', requirePermissions([PERMISSIONS.ROLES_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const rows = await registry.listAdminRolesUseCase.execute();
  const data: RoleListItem[] = rows.map((r) => ({
    ...r,
    description: registry.roleManagementUseCase.describe(r.name),
    isSystem: registry.roleManagementUseCase.isSystemRole(r.name),
  }));
  const res: ApiResponse<RoleListItem[]> = { success: true, data };
  return c.json(res);
});

/** Every permission a role may carry, grouped by module. */
routes.get('/permissions', requirePermissions([PERMISSIONS.ROLES_MANAGE]), (c) => {
  const data = Registry.getInstance().roleManagementUseCase.catalogue();
  return c.json({ success: true, data });
});

routes.post('/', requirePermissions([PERMISSIONS.ROLES_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Expected a JSON body.' } }, 400);
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.roleManagementUseCase.createRole({
    name: String(body.name ?? ''),
    permissionCodes: Array.isArray(body.permissionCodes) ? body.permissionCodes : [],
    actorId,
  });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ROLE_CREATED', entity: 'role', entityId: outcome.value.id,
    newState: { name: outcome.value.name, permissionCodes: outcome.value.permissionCodes },
  });
  return c.json({ success: true, data: outcome.value });
});

routes.put('/:id/permissions', requirePermissions([PERMISSIONS.ROLES_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Expected a JSON body.' } }, 400);
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.roleManagementUseCase.replacePermissions({
    roleId: c.req.param('id') ?? '',
    permissionCodes: Array.isArray(body.permissionCodes) ? body.permissionCodes : [],
    actorId,
  });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  const added = outcome.value.nextCodes.filter((x) => !outcome.value.previousCodes.includes(x));
  const removed = outcome.value.previousCodes.filter((x) => !outcome.value.nextCodes.includes(x));
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ROLE_PERMISSIONS_UPDATED', entity: 'role', entityId: outcome.value.role.id,
    previousState: { name: outcome.value.role.name, permissionCodes: outcome.value.previousCodes },
    newState: { name: outcome.value.role.name, permissionCodes: outcome.value.nextCodes, added, removed },
  });
  return c.json({ success: true, data: { id: outcome.value.role.id, name: outcome.value.role.name, permissionCodes: outcome.value.nextCodes, added, removed } });
});

routes.delete('/:id', requirePermissions([PERMISSIONS.ROLES_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.roleManagementUseCase.deleteRole({ roleId: c.req.param('id') ?? '', actorId });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ROLE_DELETED', entity: 'role', entityId: outcome.value.role.id,
    previousState: { name: outcome.value.role.name, permissionCodes: outcome.value.role.permissionCodes },
  });
  return c.json({ success: true, data: { id: outcome.value.role.id, name: outcome.value.role.name } });
});

export default routes;
