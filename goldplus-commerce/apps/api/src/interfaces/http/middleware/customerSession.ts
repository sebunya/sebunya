import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';

export const customerSessionMiddleware = async (c: Context<{ Variables: { userId: string; userEmail: string } }>, next: Next) => {
  const header = c.req.header('Authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

  const fail = () => {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' },
    };
    return c.json(res, 401);
  };

  if (!token) return fail();

  const verified = await Registry.getInstance().tokenSigner.verify(token);
  if (!verified) return fail();

  c.set('userId', verified.subject);
  c.set('userEmail', verified.email);
  await next();
};
