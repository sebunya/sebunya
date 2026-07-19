import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';

export const requirePermissions = (requiredPermissions: string[], errorCode: 'FORBIDDEN' | 'PERMISSION_DENIED' = 'FORBIDDEN') => {
  return async (c: Context<{ Variables: { user?: { id: string; email: string; permissions: string[] } } }>, next: Next) => {
    const user = c.get('user');

    if (!user) {
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'User not authenticated.' }
      };
      return c.json(res, 401);
    }

    const hasPermission = requiredPermissions.every(perm => user.permissions.includes(perm));

    if (!hasPermission) {
      const res: ApiResponse<never> = {
        success: false,
        error: { code: errorCode, message: 'Insufficient permissions to perform this action.' }
      };
      return c.json(res, 403);
    }

    await next();
  };
};
