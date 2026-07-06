import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
import { Registry } from '../../../infrastructure/Registry';
import { AuthenticateUserUseCase } from '../../../application/use-cases/identity/AuthenticateUserUseCase';
import { ApiResponse } from '@goldplus/shared';

import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';

const routes = new Hono();

const OAUTH_STATE_COOKIE = 'gp_oauth_state';

routes.post('/register', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const registry = Registry.getInstance();
  const result = await registry.registerUserUseCase.execute({
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
    phone: body.phone ? String(body.phone) : null,
  });

  if (!result.ok) {
    const statusCode =
      result.code === 'EMAIL_TAKEN' ? 409 : result.code === 'AUTH_NOT_CONFIGURED' ? 503 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, statusCode);
  }

  const res: ApiResponse<{ token: string; expiresAt: string; user: { id: string; email: string; phone: string | null } }> = {
    success: true,
    data: { token: result.token, expiresAt: result.expiresAt.toISOString(), user: result.user },
  };
  return c.json(res, 201);
});

// ---- Google social login (OAuth 2.0 authorization code flow) ----

routes.get('/google/start', (c) => {
  const adapter = Registry.getInstance().googleOAuthAdapter;
  if (!adapter.isConfigured()) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Google sign-in is not configured.' },
    };
    return c.json(res, 503);
  }

  // CSRF: mint a random state, store it in an HttpOnly cookie, and echo
  // it in the provider URL. The callback rejects any mismatch.
  const state = randomBytes(16).toString('hex');
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
  });

  const url = adapter.getAuthorizationUrl(state)!;
  return c.redirect(url, 302);
});

routes.get('/google/callback', async (c) => {
  const registry = Registry.getInstance();
  const code = c.req.query('code');
  const state = c.req.query('state');
  const savedState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });

  if (!code) {
    const res: ApiResponse<never> = { success: false, error: { code: 'MISSING_CODE', message: 'Authorization code missing.' } };
    return c.json(res, 400);
  }
  if (!state || !savedState || state !== savedState) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'BAD_STATE', message: 'OAuth state mismatch; possible CSRF. Please retry sign-in.' },
    };
    return c.json(res, 400);
  }

  const result = await registry.googleSocialLoginUseCase.execute({ code });
  if (!result.ok) {
    const statusCode =
      result.code === 'NOT_CONFIGURED' || result.code === 'AUTH_NOT_CONFIGURED' ? 503 :
      result.code === 'ACCOUNT_DISABLED' ? 403 :
      result.code === 'EMAIL_UNVERIFIED' ? 403 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, statusCode);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: result.user.id,
    action: 'SOCIAL_LOGIN',
    entity: 'user',
    entityId: result.user.id,
    newState: { provider: 'google', outcome: result.outcome },
  });

  const res: ApiResponse<{
    token: string;
    expiresAt: string;
    outcome: string;
    user: { id: string; email: string; phone: string | null };
  }> = {
    success: true,
    data: { token: result.token, expiresAt: result.expiresAt.toISOString(), outcome: result.outcome, user: result.user },
  };
  return c.json(res);
});

routes.post('/login', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const registry = Registry.getInstance();
  const uc = new AuthenticateUserUseCase(registry.userRepo, registry.passwordHasher, registry.tokenSigner);
  const result = await uc.execute({
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
  });

  if (!result.ok) {
    const statusCode =
      result.code === 'BAD_INPUT' ? 400 :
      result.code === 'AUTH_NOT_CONFIGURED' ? 503 :
      result.code === 'ACCOUNT_DISABLED' ? 403 :
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
  const authUc = new AuthenticateUserUseCase(registry.userRepo, registry.passwordHasher, registry.tokenSigner);
  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);

  const result = await authUc.execute({
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
  });

  if (!result.ok) {
    const statusCode =
      result.code === 'BAD_INPUT' ? 400 :
      result.code === 'AUTH_NOT_CONFIGURED' ? 503 :
      result.code === 'ACCOUNT_DISABLED' ? 403 :
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

