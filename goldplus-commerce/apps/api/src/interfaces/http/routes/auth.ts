import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { AuthenticateUserUseCase } from '../../../application/use-cases/identity/AuthenticateUserUseCase';
import { ApiResponse } from '@goldplus/shared';

import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';

const routes = new Hono();

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
//
// The browser-facing parts (redirect to Google, CSRF state cookie) live in
// the web app, which owns the user session cookie. The API only builds the
// authorization URL and performs the secret code->token exchange, so no
// access token or provider secret ever crosses into the browser.

routes.get('/google/url', (c) => {
  const adapter = Registry.getInstance().googleOAuthAdapter;
  if (!adapter.isConfigured()) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Google sign-in is not configured.' },
    };
    return c.json(res, 503);
  }

  const state = (c.req.query('state') ?? '').trim();
  if (!state) {
    const res: ApiResponse<never> = { success: false, error: { code: 'MISSING_STATE', message: 'state query param is required.' } };
    return c.json(res, 400);
  }

  const url = adapter.getAuthorizationUrl(state)!;
  const res: ApiResponse<{ url: string }> = { success: true, data: { url } };
  return c.json(res);
});

routes.post('/google/exchange', async (c) => {
  const registry = Registry.getInstance();
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const code = String(body.code ?? '').trim();
  if (!code) {
    const res: ApiResponse<never> = { success: false, error: { code: 'MISSING_CODE', message: 'Authorization code missing.' } };
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
  const email = String(body.email ?? '');
  const ipAddress =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || null;

  // Brute-force guard: hard-lock accounts with too many recent failures.
  const gate = await registry.loginSecurityUseCase.assess({ email, ipAddress });
  if (gate.locked) {
    await registry.loginSecurityUseCase.record({ email, userId: null, ipAddress, outcome: 'LOCKED', riskScore: gate.risk.score });
    c.header('Retry-After', String(gate.retryAfterSeconds));
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed sign-in attempts. Please wait a few minutes and try again.' },
    };
    return c.json(res, 429);
  }

  const uc = new AuthenticateUserUseCase(registry.userRepo, registry.passwordHasher, registry.tokenSigner);
  const result = await uc.execute({ email, password: String(body.password ?? '') });

  if (!result.ok) {
    if (result.code === 'INVALID_CREDENTIALS' || result.code === 'ACCOUNT_DISABLED') {
      await registry.loginSecurityUseCase.record({ email, userId: null, ipAddress, outcome: 'BAD_CREDENTIALS', riskScore: gate.risk.score });
    }
    const statusCode =
      result.code === 'BAD_INPUT' ? 400 :
      result.code === 'AUTH_NOT_CONFIGURED' ? 503 :
      result.code === 'ACCOUNT_DISABLED' ? 403 :
      401;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, statusCode);
  }

  await registry.loginSecurityUseCase.record({ email, userId: result.user.id, ipAddress, outcome: 'SUCCESS', riskScore: gate.risk.score });

  // If the account has 2FA enabled, don't hand out a full session yet.
  // Issue a short-lived 2fa_pending token that only /auth/2fa/login accepts.
  const twoFactor = await registry.getTwoFactorStatusUseCase.execute(result.user.id);
  if (twoFactor.enabled) {
    const pendingToken = await registry.tokenSigner.sign({
      subject: result.user.id,
      email: result.user.email,
      ttlSeconds: 300,
      scope: '2fa_pending',
    });
    const res: ApiResponse<{ twoFactorRequired: true; method: string; pendingToken: string }> = {
      success: true,
      data: { twoFactorRequired: true, method: twoFactor.method, pendingToken },
    };
    return c.json(res);
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

