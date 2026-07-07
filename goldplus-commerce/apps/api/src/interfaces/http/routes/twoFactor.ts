import { Hono } from 'hono';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { Registry } from '../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse } from '@goldplus/shared';

const routes = new Hono<{ Variables: { userId: string; userEmail: string } }>();
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

async function readJson(c: any): Promise<any | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

async function audit(userId: string, action: string, newState?: Record<string, unknown>) {
  const registry = Registry.getInstance();
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: userId, action, entity: 'user', entityId: userId, newState });
}

/** Resolves a 2fa_pending token (issued by /auth/login) to a user. */
async function resolvePending(c: any): Promise<{ userId: string; email: string } | null> {
  const body = await readJson(c);
  const token = String(body?.pendingToken ?? '').trim();
  if (!token) return null;
  const verified = await Registry.getInstance().tokenSigner.verify(token);
  if (!verified || verified.scope !== '2fa_pending') return null;
  (c as any).__body = body; // cache parsed body for the handler
  return { userId: verified.subject, email: verified.email };
}

// ---------------------------------------------------------------------------
// Enrolment & management (full session required).
// ---------------------------------------------------------------------------

routes.get('/status', customerSessionMiddleware, async (c) => {
  const data = await Registry.getInstance().getTwoFactorStatusUseCase.execute(c.get('userId'));
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/totp/enroll', customerSessionMiddleware, async (c) => {
  const result = await Registry.getInstance().enrollTotpUseCase.execute(c.get('userId'));
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 409;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  // Secret + otpauth URI are shown once so the user can add it to their app.
  return c.json({ success: true, data: { secret: result.secret, otpauthUri: result.otpauthUri } });
});

routes.post('/totp/confirm', customerSessionMiddleware, async (c) => {
  const body = await readJson(c);
  const result = await Registry.getInstance().confirmTotpUseCase.execute({
    userId: c.get('userId'),
    code: String(body?.code ?? ''),
  });
  if (!result.ok) {
    const status = result.code === 'NO_PENDING' ? 409 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  await audit(c.get('userId'), 'TWO_FACTOR_ENABLED', { method: 'totp' });
  return c.json({ success: true, data: { backupCodes: result.backupCodes } });
});

routes.post('/otp/start', customerSessionMiddleware, async (c) => {
  const body = await readJson(c);
  const registry = Registry.getInstance();
  const channel = body?.channel === 'sms' ? 'sms' : 'email';
  const user = await registry.userRepo.findById(c.get('userId'));
  if (!user) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } } satisfies ApiResponse<never>, 404);

  const destination = channel === 'sms' ? user.phone ?? '' : user.email;
  if (!destination) {
    return c.json(
      { success: false, error: { code: 'NO_DESTINATION', message: `No ${channel} on file for this account.` } } satisfies ApiResponse<never>,
      400
    );
  }

  const result = await registry.startOtpChallengeUseCase.execute({
    userId: c.get('userId'),
    channel,
    destination,
    purpose: channel === 'sms' ? 'enroll_sms' : 'enroll_email',
  });
  if (!result.ok) {
    const status = result.code === 'THROTTLED' ? 429 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  return c.json({
    success: true,
    data: { challengeId: result.challengeId, destination: result.destinationMasked, expiresAt: result.expiresAt, delivery: result.delivery },
  });
});

routes.post('/otp/confirm', customerSessionMiddleware, async (c) => {
  const body = await readJson(c);
  const registry = Registry.getInstance();
  const verify = await registry.verifyOtpChallengeUseCase.execute({
    challengeId: String(body?.challengeId ?? ''),
    code: String(body?.code ?? ''),
  });
  if (!verify.ok) {
    const status = verify.code === 'NOT_FOUND' ? 404 : verify.code === 'TOO_MANY_ATTEMPTS' ? 429 : 400;
    return c.json({ success: false, error: { code: verify.code, message: verify.message } } satisfies ApiResponse<never>, status);
  }
  if (verify.userId !== c.get('userId') || (verify.purpose !== 'enroll_sms' && verify.purpose !== 'enroll_email')) {
    return c.json({ success: false, error: { code: 'BAD_CHALLENGE', message: 'Challenge does not match this action.' } } satisfies ApiResponse<never>, 400);
  }
  const method = verify.channel === 'sms' ? 'sms' : 'email';
  const enabled = await registry.enableOtpTwoFactorUseCase.execute({ userId: c.get('userId'), method });
  await audit(c.get('userId'), 'TWO_FACTOR_ENABLED', { method });
  return c.json({ success: true, data: { backupCodes: enabled.backupCodes } });
});

routes.post('/disable', customerSessionMiddleware, async (c) => {
  const body = await readJson(c);
  const result = await Registry.getInstance().disableTwoFactorUseCase.execute({
    userId: c.get('userId'),
    code: String(body?.code ?? ''),
  });
  if (!result.ok) {
    const status = result.code === 'NOT_ENABLED' ? 409 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  await audit(c.get('userId'), 'TWO_FACTOR_DISABLED');
  return c.json({ success: true, data: { status: 'disabled' } });
});

// ---------------------------------------------------------------------------
// Login completion (uses the 2fa_pending token from /auth/login).
// ---------------------------------------------------------------------------

async function issueSession(userId: string, email: string) {
  const token = await Registry.getInstance().tokenSigner.sign({ subject: userId, email, ttlSeconds: SESSION_TTL_SECONDS });
  return { token, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString() };
}

routes.post('/login', async (c) => {
  const pending = await resolvePending(c);
  if (!pending) return c.json({ success: false, error: { code: 'BAD_PENDING', message: 'Invalid or expired sign-in session. Start again.' } } satisfies ApiResponse<never>, 401);
  const body = (c as any).__body;

  const verified = await Registry.getInstance().verifyTotpOrBackupUseCase.execute({
    userId: pending.userId,
    code: String(body?.code ?? ''),
  });
  if (!verified.ok) {
    const status = verified.code === 'NOT_ENABLED' ? 409 : 401;
    return c.json({ success: false, error: { code: verified.code, message: verified.message } } satisfies ApiResponse<never>, status);
  }
  await audit(pending.userId, 'TWO_FACTOR_LOGIN', { usedBackupCode: verified.usedBackupCode });
  const session = await issueSession(pending.userId, pending.email);
  return c.json({ success: true, data: { token: session.token, expiresAt: session.expiresAt } });
});

routes.post('/login/otp/start', async (c) => {
  const pending = await resolvePending(c);
  if (!pending) return c.json({ success: false, error: { code: 'BAD_PENDING', message: 'Invalid or expired sign-in session. Start again.' } } satisfies ApiResponse<never>, 401);
  const registry = Registry.getInstance();
  const config = await registry.twoFactorRepo.find(pending.userId);
  const user = await registry.userRepo.findById(pending.userId);
  if (!config?.enabled || (config.method !== 'sms' && config.method !== 'email') || !user) {
    return c.json({ success: false, error: { code: 'NOT_APPLICABLE', message: 'This account does not use a code by SMS or email.' } } satisfies ApiResponse<never>, 409);
  }
  const destination = config.method === 'sms' ? user.phone ?? '' : user.email;
  const result = await registry.startOtpChallengeUseCase.execute({
    userId: pending.userId,
    channel: config.method,
    destination,
    purpose: 'login_2fa',
  });
  if (!result.ok) {
    const status = result.code === 'THROTTLED' ? 429 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, status);
  }
  return c.json({ success: true, data: { challengeId: result.challengeId, destination: result.destinationMasked, expiresAt: result.expiresAt, delivery: result.delivery } });
});

routes.post('/login/otp/verify', async (c) => {
  const pending = await resolvePending(c);
  if (!pending) return c.json({ success: false, error: { code: 'BAD_PENDING', message: 'Invalid or expired sign-in session. Start again.' } } satisfies ApiResponse<never>, 401);
  const body = (c as any).__body;
  const registry = Registry.getInstance();

  const verify = await registry.verifyOtpChallengeUseCase.execute({
    challengeId: String(body?.challengeId ?? ''),
    code: String(body?.code ?? ''),
  });
  if (!verify.ok) {
    const status = verify.code === 'NOT_FOUND' ? 404 : verify.code === 'TOO_MANY_ATTEMPTS' ? 429 : 401;
    return c.json({ success: false, error: { code: verify.code, message: verify.message } } satisfies ApiResponse<never>, status);
  }
  if (verify.userId !== pending.userId || verify.purpose !== 'login_2fa') {
    return c.json({ success: false, error: { code: 'BAD_CHALLENGE', message: 'Challenge does not match this sign-in.' } } satisfies ApiResponse<never>, 400);
  }
  await audit(pending.userId, 'TWO_FACTOR_LOGIN', { channel: verify.channel });
  const session = await issueSession(pending.userId, pending.email);
  return c.json({ success: true, data: { token: session.token, expiresAt: session.expiresAt } });
});

export default routes;
