import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { logger } from '../../../infrastructure/logging/logger';

/**
 * Fail-closed permission gate.
 *
 * Denials are recorded. An authenticated session being refused a privileged
 * action is a security signal — it is what credential theft, a stale role
 * assignment, or someone probing the admin surface looks like from the inside —
 * and previously it produced a 403 and nothing else. There was no way to notice
 * one account being refused two hundred times.
 *
 * It is written to the structured log rather than the audit table on purpose.
 * A denial path that writes to the database on every rejection is a
 * self-inflicted denial-of-service vector: anyone with any valid session could
 * drive unbounded writes by hammering an endpoint they cannot use. The log line
 * carries the actor id and what was required — never the token, the session, or
 * anything about the request body.
 */
export const requirePermissions = (requiredPermissions: string[], errorCode: 'FORBIDDEN' | 'PERMISSION_DENIED' = 'FORBIDDEN') => {
  return async (c: Context<{ Variables: { user?: { id: string; email: string; permissions: string[] } } }>, next: Next) => {
    const user = c.get('user');

    if (!user) {
      logger.warn(
        { path: c.req.path, method: c.req.method, required: requiredPermissions },
        'AUTHZ_DENIED_UNAUTHENTICATED',
      );
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'User not authenticated.' }
      };
      return c.json(res, 401);
    }

    const granted = new Set(user.permissions);
    const missing = requiredPermissions.filter((perm) => !granted.has(perm));

    if (missing.length > 0) {
      logger.warn(
        {
          actorId: user.id,
          path: c.req.path,
          method: c.req.method,
          required: requiredPermissions,
          // What was missing, not what the actor holds: the full grant list adds
          // nothing to the investigation and is more to leak into log storage.
          missing,
        },
        'AUTHZ_DENIED',
      );
      const res: ApiResponse<never> = {
        success: false,
        // Deliberately identical for every denial. Naming the missing
        // permission back to the caller maps out the permission model for
        // anyone probing it.
        error: { code: errorCode, message: 'Insufficient permissions to perform this action.' }
      };
      return c.json(res, 403);
    }

    await next();
  };
};
