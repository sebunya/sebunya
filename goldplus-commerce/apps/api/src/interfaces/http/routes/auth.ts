import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { AuthenticateUserUseCase } from '../../../application/use-cases/identity/AuthenticateUserUseCase';
import { ApiResponse } from '@goldplus/shared';

const routes = new Hono();

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

export default routes;
