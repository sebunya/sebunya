import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { bearerTokenFrom, resolveLiveSession } from './liveSession';

type AdminContext = Context<{
  Variables: {
    user: { id: string; email: string; permissions: string[] };
  };
}>;

export const authMiddleware = async (c: AdminContext, next: Next) => {
  const fail = (code: string, message: string, status: 401 | 403 = 401) => {
    const res: ApiResponse<never> = { success: false, error: { code, message } };
    return c.json(res, status);
  };

  const token = bearerTokenFrom(c.req.header('Authorization'));
  if (!token) return fail('UNAUTHENTICATED', 'Missing or invalid authentication token.');

  // The live-session rule (account exists, is enabled, and its token predates no
  // revocation cutoff) is shared with the customer middleware and bearerUser, so
  // the three cannot drift apart. Admin additionally requires permissions.
  const session = await resolveLiveSession(token);
  if (!session.ok) {
    return fail(session.code, session.message, session.code === 'ACCOUNT_DISABLED' ? 403 : 401);
  }
  const user = session.user;

  const permissions = await Registry.getInstance().roleRepo.findPermissionsForUser(user.id);
  if (permissions.length === 0) {
    return fail('FORBIDDEN', 'This account does not have admin access.', 403);
  }

  c.set('user', { id: user.id, email: user.email, permissions });
  await next();
};

