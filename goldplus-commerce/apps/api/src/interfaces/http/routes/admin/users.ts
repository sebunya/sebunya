import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { requireStepUp } from '../../middleware/requireStepUp';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { AdminUserDto } from '../../../../application/use-cases/admin/ListAdminUsersUseCase';

const routes = new Hono();
routes.use('*', authMiddleware);

// Staff accounts only (2026-10-17): an account holding a role or a pending grant. Shoppers are counted in a header,
// never listed here, so no customer sits one click away from a back-office role.
routes.get('/', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const useCase = Registry.getInstance().listAdminUsersUseCase;
  const [data, shoppers] = await Promise.all([useCase.execute(), useCase.shopperAccountCount().catch(() => null)]);

  const res: ApiResponse<AdminUserDto[]> = { success: true, data };
  if (shoppers != null) c.header('X-Shopper-Accounts', String(shoppers));
  return c.json(res);
});

// One account by its exact email (staff or shopper), for the deliberate "give an existing account access" step.
routes.get('/lookup', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const email = String(c.req.query('email') ?? '').trim();
  if (!email || email.length > 320 || !email.includes('@')) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Enter the full email address of the account.' } }, 400);
  const account = await Registry.getInstance().listAdminUsersUseCase.lookup(email);
  if (!account) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No account uses that email. The person must create an account on the shop first, or create a staff account below.' } }, 404);
  return c.json({ success: true, data: account });
});

// ---- §6 completion: governed user creation + role assignment ----------------
// PLATFORM_ADMINISTRATOR is never granted directly (maker/checker request flow);
// lesser governance roles assign directly. All mutations audited. Initial
// passwords are communicated out-of-band by the creating administrator and are
// never logged.

routes.post('/', requirePermissions([PERMISSIONS.AUTH_MANAGE]), requireStepUp('user_admin'), async (c) => {
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

routes.post('/grant-requests/:id/decide', requirePermissions([PERMISSIONS.AUTH_MANAGE]), requireStepUp('user_admin'), async (c) => {
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
  const audit = new CreateAuditLogUseCase(registry.auditRepo);
  await audit.execute({
    actorId, action: 'ADMIN_ROLE_GRANT_DECIDED', entity: 'role_grant_request', entityId: c.req.param('id') ?? '',
    newState: { decision, userId: outcome.value.userId, roleName: outcome.value.roleName },
  });
  if (decision === 'APPROVED') {
    // The receiving user's own History (entity=user) must show they were given
    // full access — the request row alone never reached it.
    await audit.execute({
      actorId, action: 'ADMIN_ROLE_GRANT_APPROVED', entity: 'user', entityId: outcome.value.userId,
      newState: { roleName: outcome.value.roleName, requestId: c.req.param('id') ?? '' },
    });
  }
  return c.json({ success: true, data: outcome.value });
});

routes.post('/:id/roles', requirePermissions([PERMISSIONS.AUTH_MANAGE]), requireStepUp('user_admin'), async (c) => {
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
    actorId, action: outcome.value.firstAccess ? 'ADMIN_FIRST_BACK_OFFICE_ACCESS_GRANTED' : 'ADMIN_ROLE_GRANTED', entity: 'user', entityId: c.req.param('id') ?? '',
    newState: { roleName: String(body?.roleName ?? ''), outcome: outcome.value.outcome, firstAccess: outcome.value.firstAccess, reason: typeof body?.reason === 'string' ? body.reason.slice(0, 300) : null },
  });
  return c.json({ success: true, data: outcome.value });
});

routes.post('/:id/roles/revoke', requirePermissions([PERMISSIONS.AUTH_MANAGE]), requireStepUp('user_admin'), async (c) => {
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

/**
 * Deactivate / reactivate an account (pre-live audit, 2026-09-12). Guards live in
 * the use case: not yourself, not the last active PLATFORM_ADMINISTRATOR, a
 * reason for deactivation; live sessions of a deactivated account are ended.
 */
routes.post('/:id/active', requirePermissions([PERMISSIONS.AUTH_MANAGE]), requireStepUp('user_admin'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const actorId = (c.get('user') as { id: string }).id;
  const active = body?.active === true;
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 300) : null;
  const id = c.req.param('id') ?? '';
  const registry = Registry.getInstance();
  const outcome = await registry.adminUserManagementUseCase.setActive({ userId: id, active, actorId, reason });
  if (!outcome.ok) return c.json({ success: false, error: { code: outcome.code, message: outcome.message } }, outcome.status as 400 | 403 | 404 | 409);
  if (outcome.value.changed) {
    await registry.createAuditLogUseCase.execute({
      actorId, action: active ? 'ADMIN_USER_REACTIVATED' : 'ADMIN_USER_DEACTIVATED', entity: 'user', entityId: id,
      previousState: { isActive: !active }, newState: { isActive: active, reason },
    });
  }
  return c.json({ success: true, data: outcome.value });
});

routes.post('/grant-requests/:id/withdraw', requirePermissions([PERMISSIONS.AUTH_MANAGE]), requireStepUp('user_admin'), async (c) => {
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


