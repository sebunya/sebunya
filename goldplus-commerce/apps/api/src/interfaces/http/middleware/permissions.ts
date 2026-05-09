import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';

export const requirePermissions = (requiredPermissions: string[]) => {
  return async (c: Context, next: Next) => {
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
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions to perform this action.' }
      };
      return c.json(res, 403);
    }

    await next();
  };
};
