import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { AuthenticateUserUseCase } from '../../../application/use-cases/identity/AuthenticateUserUseCase';
import { ApiResponse } from '@goldplus/shared';
import { clientIp } from '../clientAddress';

import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';

const routes = new Hono();

routes.post('/login', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const registry = Registry.getInstance();
  const uc = new AuthenticateUserUseCase(registry.userRepo, registry.passwordHasher, registry.tokenSigner, registry.loginAttemptStore);
  const result = await uc.execute({
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
    ip: clientIp(c),
  });

  if (!result.ok) {
    if (result.code === 'LOCKED' && result.retryAfterSeconds) {
      c.header('Retry-After', String(result.retryAfterSeconds));
    }
    const statusCode =
      result.code === 'BAD_INPUT' ? 400 :
      result.code === 'AUTH_NOT_CONFIGURED' ? 503 :
      result.code === 'ACCOUNT_DISABLED' ? 403 :
      result.code === 'LOCKED' ? 429 :
      401;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, statusCode);
  }

  const res: ApiResponse<{
    token: string;
    expiresAt: string;
    user: { id: string; email: string; phone: string | null };
  }> = {
    success: true,
    data: {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: result.user,
    },
  };
  return c.json(res);
});

routes.post('/admin/login', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const registry = Registry.getInstance();
  const authUc = new AuthenticateUserUseCase(registry.userRepo, registry.passwordHasher, registry.tokenSigner, registry.loginAttemptStore);
  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);

  const result = await authUc.execute({
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
    ip: clientIp(c),
  });

  if (!result.ok) {
    if (result.code === 'LOCKED' && result.retryAfterSeconds) {
      c.header('Retry-After', String(result.retryAfterSeconds));
    }
    const statusCode =
      result.code === 'BAD_INPUT' ? 400 :
      result.code === 'AUTH_NOT_CONFIGURED' ? 503 :
      result.code === 'ACCOUNT_DISABLED' ? 403 :
      result.code === 'LOCKED' ? 429 :
      401;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, statusCode);
  }

  const permissions = await registry.roleRepo.findPermissionsForUser(result.user.id);
  if (permissions.length === 0) {
    await auditUc.execute({
      actorId: result.user.id,
      action: 'ADMIN_LOGIN_DENIED',
      entity: 'user',
      entityId: result.user.id,
      newState: { reason: 'no_roles_assigned' },
    });
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'FORBIDDEN', message: 'This account does not have admin access.' },
    };
    return c.json(res, 403);
  }

  await auditUc.execute({
    actorId: result.user.id,
    action: 'ADMIN_LOGIN',
    entity: 'user',
    entityId: result.user.id,
    newState: { email: result.user.email, permissionCount: permissions.length },
  });

  const res: ApiResponse<{
    token: string;
    expiresAt: string;
    user: { id: string; email: string; permissions: string[] };
  }> = {
    success: true,
    data: {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: { id: result.user.id, email: result.user.email, permissions },
    },
  };
  return c.json(res);
});

export default routes;

