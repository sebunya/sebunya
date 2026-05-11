import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';

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

  const header = c.req.header('Authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  if (!token) return fail('UNAUTHENTICATED', 'Missing or invalid authentication token.');

  const registry = Registry.getInstance();
  const verified = await registry.tokenSigner.verify(token);
  if (!verified) return fail('UNAUTHENTICATED', 'Invalid or expired session.');

  const user = await registry.userRepo.findById(verified.subject);
  if (!user) return fail('UNAUTHENTICATED', 'User no longer exists.');
  if (!user.isActive) return fail('ACCOUNT_DISABLED', 'This account has been disabled.', 403);

  const permissions = await registry.roleRepo.findPermissionsForUser(user.id);
  if (permissions.length === 0) {
    return fail('FORBIDDEN', 'This account does not have admin access.', 403);
  }

  c.set('user', { id: user.id, email: user.email, permissions });
  await next();
};

