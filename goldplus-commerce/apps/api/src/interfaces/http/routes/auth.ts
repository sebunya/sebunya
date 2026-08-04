import { Hono, Context } from 'hono';
import { createHash } from 'node:crypto';
import { Registry } from '../../../infrastructure/Registry';
import { AuthenticateUserUseCase } from '../../../application/use-cases/identity/AuthenticateUserUseCase';
import { RegisterCustomerUseCase } from '../../../application/use-cases/identity/RegisterCustomerUseCase';
import { ApiResponse } from '@goldplus/shared';
import { clientIp } from '../clientAddress';
import { SESSION_LIFETIMES } from '../../../domain/identity/SessionPolicy';

import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';

const routes = new Hono();

/**
 * Issue a durable session on login, best-effort. A session-store hiccup must
 * never block a valid login — the short-lived access token still works; refresh
 * is simply unavailable until the store recovers. Gated out of the test
 * environment so the hermetic unit suite (which drives /auth/login against the
 * real app without a database) stays network-free; the durable behaviour is
 * proven by the real-PostgreSQL integration suite.
 */
async function issueSessionSafely(
  registry: ReturnType<typeof Registry.getInstance>,
  userId: string,
  c: Context,
): Promise<{ refreshToken: string; refreshExpiresAt: string } | null> {
  if (process.env.NODE_ENV === 'test') return null;
  try {
    const ipHash = createHash('sha256').update(clientIp(c)).digest('hex');
    const uaHash = createHash('sha256')
      .update(c.req.header('user-agent') ?? '')
      .digest('hex');
    const s = await registry.sessionService.issue({ userId, ipHash, userAgentHash: uaHash });
    return { refreshToken: s.refreshToken, refreshExpiresAt: s.refreshExpiresAt.toISOString() };
  } catch {
    return null;
  }
}

/** Resolve the authenticated user from a bearer token, or null. */
async function bearerUser(c: Context): Promise<{ id: string; email: string } | null> {
  const header = c.req.header('Authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  if (!token) return null;
  const verified = await Registry.getInstance().tokenSigner.verify(token);
  return verified ? { id: verified.subject, email: verified.email } : null;
}

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

  const refresh = await issueSessionSafely(registry, result.user.id, c);

  const res: ApiResponse<{
    token: string;
    expiresAt: string;
    refreshToken?: string;
    refreshExpiresAt?: string;
    user: { id: string; email: string; phone: string | null };
  }> = {
    success: true,
    data: {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      ...(refresh ? { refreshToken: refresh.refreshToken, refreshExpiresAt: refresh.refreshExpiresAt } : {}),
      user: result.user,
    },
  };
  return c.json(res);
});

routes.post('/register', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const registry = Registry.getInstance();
  const uc = new RegisterCustomerUseCase(registry.userRepo, registry.passwordHasher, registry.tokenSigner);
  const result = await uc.execute({
    email: String(body.email ?? ''),
    phone: String(body.phone ?? ''),
    password: String(body.password ?? ''),
  });

  if (!result.ok) {
    const statusCode =
      result.code === 'BAD_INPUT' ? 400 :
      result.code === 'AUTH_NOT_CONFIGURED' ? 503 :
      409; // ALREADY_REGISTERED
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, statusCode);
  }

  // Registration IS a login: same durable session, same response shape, so the
  // storefront handles both flows with one code path.
  const refresh = await issueSessionSafely(registry, result.user.id, c);

  const res: ApiResponse<{
    token: string;
    expiresAt: string;
    refreshToken?: string;
    refreshExpiresAt?: string;
    user: { id: string; email: string; phone: string | null };
  }> = {
    success: true,
    data: {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      ...(refresh ? { refreshToken: refresh.refreshToken, refreshExpiresAt: refresh.refreshExpiresAt } : {}),
      user: result.user,
    },
  };
  return c.json(res, 201);
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

  const refresh = await issueSessionSafely(registry, result.user.id, c);

  const res: ApiResponse<{
    token: string;
    expiresAt: string;
    refreshToken?: string;
    refreshExpiresAt?: string;
    user: { id: string; email: string; permissions: string[] };
  }> = {
    success: true,
    data: {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      ...(refresh ? { refreshToken: refresh.refreshToken, refreshExpiresAt: refresh.refreshExpiresAt } : {}),
      user: { id: result.user.id, email: result.user.email, permissions },
    },
  };
  return c.json(res);
});

/**
 * Slice 3B — rotate a refresh credential for a new access token + a new refresh
 * token. Reuse of a consumed credential is detected in the service and revokes
 * the whole family; here it simply reads as a failed refresh.
 */
routes.post('/refresh', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } }, 400);
  }
  const refreshToken = String(body.refreshToken ?? '');
  if (!refreshToken) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'A refresh token is required.' } }, 400);
  }

  const registry = Registry.getInstance();
  const result = await registry.sessionService.rotate({ refreshToken });
  if (!result.ok) {
    // One generic message: an attacker must not learn whether a token was
    // expired, revoked or reused.
    return c.json(
      { success: false, error: { code: 'SESSION_INVALID', message: 'Please sign in again.' } },
      401,
    );
  }

  const user = await registry.userRepo.findById(result.session.userId);
  if (!user || !user.isActive) {
    await registry.sessionService.logoutAll(result.session.userId, 'account_disabled');
    return c.json(
      { success: false, error: { code: 'SESSION_INVALID', message: 'Please sign in again.' } },
      401,
    );
  }

  const token = await registry.tokenSigner.sign({
    subject: user.id,
    email: user.email,
    ttlSeconds: Math.floor(SESSION_LIFETIMES.accessTtlMs / 1000),
  });

  return c.json({
    success: true,
    data: {
      token,
      expiresAt: result.session.accessExpiresAt.toISOString(),
      refreshToken: result.session.refreshToken,
      refreshExpiresAt: result.session.refreshExpiresAt.toISOString(),
    },
  });
});

/** Log out the current session (revoke the presented refresh token's family). */
routes.post('/logout', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const refreshToken = String(body?.refreshToken ?? '');
  if (refreshToken) await Registry.getInstance().sessionService.logout(refreshToken);
  // Idempotent: logging out an unknown/absent token still succeeds.
  return c.json({ success: true, data: { loggedOut: true } });
});

/** Log out everywhere — revoke every session for the authenticated user. */
routes.post('/logout-all', async (c) => {
  const user = await bearerUser(c);
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' } }, 401);
  }
  const revoked = await Registry.getInstance().sessionService.logoutAll(user.id, 'logout_all');
  return c.json({ success: true, data: { revoked } });
});

/** The authenticated user's active-session inventory. */
routes.get('/sessions', async (c) => {
  const user = await bearerUser(c);
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' } }, 401);
  }
  const items = await Registry.getInstance().sessionRepository.listActiveForUser(user.id, new Date());
  return c.json({
    success: true,
    data: {
      sessions: items.map((s) => ({
        familyId: s.familyId,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        refreshExpiresAt: s.refreshExpiresAt.toISOString(),
      })),
    },
  });
});

// ---- Slice 3C: privileged MFA management ------------------------------------

/** Begin TOTP enrolment — returns the secret + otpauth URI to show as a QR. */
routes.post('/mfa/enrol', async (c) => {
  const user = await bearerUser(c);
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' } }, 401);
  }
  const start = await Registry.getInstance().mfaService.beginEnrolment(user.id, user.email);
  return c.json({ success: true, data: { secret: start.secret, otpauthUri: start.otpauthUri } });
});

/** Confirm enrolment with the first code; returns one-time recovery codes. */
routes.post('/mfa/confirm', async (c) => {
  const user = await bearerUser(c);
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' } }, 401);
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const result = await Registry.getInstance().mfaService.confirmEnrolment(user.id, String(body?.code ?? ''));
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'MFA_CODE_INVALID', message: 'That code was not valid.' } }, 400);
  }
  const audit = new CreateAuditLogUseCase(Registry.getInstance().auditRepo);
  await audit.execute({ actorId: user.id, action: 'MFA_ENROLLED', entity: 'user', entityId: user.id, newState: { confirmed: true } });
  return c.json({ success: true, data: { recoveryCodes: result.recoveryCodes } });
});

/** Step-up: prove a TOTP code (or a recovery code) to refresh assurance. */
routes.post('/mfa/verify', async (c) => {
  const user = await bearerUser(c);
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' } }, 401);
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const svc = Registry.getInstance().mfaService;
  const code = String(body?.code ?? '');
  const verified =
    (await svc.verify(user.id, code)) || (body?.recovery ? await svc.useRecoveryCode(user.id, code) : false);
  if (!verified) {
    return c.json({ success: false, error: { code: 'MFA_CODE_INVALID', message: 'That code was not valid.' } }, 400);
  }
  return c.json({ success: true, data: { verified: true } });
});

/** Whether the caller has MFA enrolled/confirmed (drives the UI). */
routes.get('/mfa/status', async (c) => {
  const user = await bearerUser(c);
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' } }, 401);
  }
  const status = await Registry.getInstance().mfaService.status(user.id);
  return c.json({ success: true, data: status });
});

export default routes;

