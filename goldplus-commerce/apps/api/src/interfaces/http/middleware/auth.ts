import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';

// Simple mock auth middleware for Phase 1 MVP
export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid authentication token.' }
    };
    return c.json(res, 401);
  }

  // Set mock user for testing/phase 1
  c.set('user', {
    id: 'mock-user-id',
    email: 'admin@goldplus.co.ug',
    permissions: ['products.read', 'products.write', 'products.publish', 'orders.manage', 'payments.confirm'] // Admin role
  });

  await next();
};
