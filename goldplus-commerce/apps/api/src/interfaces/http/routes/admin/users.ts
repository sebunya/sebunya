import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { AdminUserDto } from '../../../../application/use-cases/admin/ListAdminUsersUseCase';

const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const useCase = Registry.getInstance().listAdminUsersUseCase;
  const data = await useCase.execute();

  const res: ApiResponse<AdminUserDto[]> = { success: true, data };
  return c.json(res);
});

// ---- §6 completion: governed user creation + role assignment ----------------
// PLATFORM_ADMINISTRATOR is never granted directly (maker/checker request flow);
// lesser governance roles assign directly. All mutations audited. Initial
// passwords are communicated out-of-band by the creating administrator and are
// never logged.

routes.post('/', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Expected a JSON body.' } }, 400);
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.adminUserManagementUseCase.createUser({
    email: String(body.email ?? ''),
    phone: typeof body.phone === 'string' ? body.phone : null,
    initialPassword: String(body.initialPassword ?? ''),
    roleName: String(body.roleName ?? ''),
    actorId,
  });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ADMIN_USER_CREATED', entity: 'user', entityId: outcome.value.userId,
    newState: { email: outcome.value.email, roleName: String(body.roleName ?? ''), roleOutcome: outcome.value.roleOutcome },
  });
  return c.json({ success: true, data: outcome.value });
});

routes.get('/grant-requests', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const requests = await Registry.getInstance().adminUserWriteRepo.listGrantRequests();
  return c.json({ success: true, data: { requests } });
});

routes.post('/grant-requests/:id/decide', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const decision = body?.decision === 'APPROVED' ? 'APPROVED' : body?.decision === 'REJECTED' ? 'REJECTED' : null;
  if (!decision) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'decision must be APPROVED or REJECTED.' } }, 400);
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.adminUserManagementUseCase.decideGrant({
    requestId: c.req.param('id') ?? '', decision, actorId, reason: typeof body?.reason === 'string' ? body.reason : null,
  });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ADMIN_ROLE_GRANT_DECIDED', entity: 'role_grant_request', entityId: c.req.param('id') ?? '',
    newState: { decision },
  });
  return c.json({ success: true, data: outcome.value });
});

routes.post('/:id/roles', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.adminUserManagementUseCase.grantRole({
    userId: c.req.param('id') ?? '', roleName: String(body?.roleName ?? ''), actorId,
    reason: typeof body?.reason === 'string' ? body.reason : null,
  });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ADMIN_ROLE_GRANTED', entity: 'user', entityId: c.req.param('id') ?? '',
    newState: { roleName: String(body?.roleName ?? ''), outcome: outcome.value.outcome },
  });
  return c.json({ success: true, data: outcome.value });
});

routes.post('/:id/roles/revoke', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.adminUserManagementUseCase.revokeRole({
    userId: c.req.param('id') ?? '', roleName: String(body?.roleName ?? ''), actorId,
  });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ADMIN_ROLE_REVOKED', entity: 'user', entityId: c.req.param('id') ?? '',
    newState: { roleName: String(body?.roleName ?? ''), revoked: outcome.value.revoked },
  });
  return c.json({ success: true, data: outcome.value });
});

routes.post('/grant-requests/:id/withdraw', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as { id: string }).id;
  const outcome = await registry.adminUserManagementUseCase.withdrawGrant({ requestId: c.req.param('id') ?? '', actorId });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as any);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'ADMIN_ROLE_GRANT_WITHDRAWN', entity: 'role_grant_request', entityId: c.req.param('id') ?? '', newState: { withdrawn: true },
  });
  return c.json({ success: true, data: outcome.value });
});

export default routes;


