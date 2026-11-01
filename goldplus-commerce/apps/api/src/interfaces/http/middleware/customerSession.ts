import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { resolveLiveSession } from './liveSession';

export const customerSessionMiddleware = async (c: Context<{ Variables: { userId: string; userEmail: string } }>, next: Next) => {
  const header = c.req.header('Authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

  // A signature proves the token was issued, not that the account still exists,
  // is still enabled, or has not been signed out since. The admin middleware
  // already checked all three; this one stopped at the signature, so a customer
  // password reset could not actually end a stolen session.
  const session = await resolveLiveSession(token);
  if (!session.ok) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: session.code, message: session.message },
    };
    return c.json(res, session.code === 'ACCOUNT_DISABLED' ? 403 : 401);
  }

  c.set('userId', session.user.id);
  c.set('userEmail', session.user.email);
  await next();
};

/**
 * Same checks, but an anonymous caller is allowed through.
 *
 * For public endpoints that a logged-out browser legitimately calls, yet which
 * must never take the caller's word for WHO they are. A present token is still
 * fully verified: a revoked or disabled session is rejected rather than quietly
 * downgraded to anonymous, which would let a signed-out session keep writing.
 */
export const optionalCustomerSessionMiddleware = async (c: Context<{ Variables: { userId?: string; userEmail?: string } }>, next: Next) => {
  const header = c.req.header('Authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  if (!token) {
    await next();
    return;
  }
  const session = await resolveLiveSession(token);
  if (!session.ok) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: session.code, message: session.message },
    };
    return c.json(res, session.code === 'ACCOUNT_DISABLED' ? 403 : 401);
  }
  c.set('userId', session.user.id);
  c.set('userEmail', session.user.email);
  await next();
};
