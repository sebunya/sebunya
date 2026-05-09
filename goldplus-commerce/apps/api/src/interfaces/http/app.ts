import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ApiResponse } from '@goldplus/shared';

// Define typed variables for the Hono context
type Variables = {
  requestId: string;
};

const app = new Hono<{ Variables: Variables }>();

// Global Middleware
app.use('*', cors());
app.use('*', logger());

// Request ID Middleware
app.use('*', async (c, next) => {
  const reqId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
  c.set('requestId', reqId);
  await next();
});

// Health Check
app.get('/health', (c) => {
  const res: ApiResponse<{ status: string; timestamp: string }> = {
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
  };
  return c.json(res);
});

// Error Handling
app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`);
  // Intentionally omitting err.stack in response to avoid leaking details
  const res: ApiResponse<never> = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
    meta: {
      requestId: c.get('requestId') as string,
    }
  };
  return c.json(res, 500);
});

// Not Found
app.notFound((c) => {
  // Use a fallback for requestId if we hit notFound before middleware executes
  const reqId = c.get('requestId') as string | undefined;
  
  const res: ApiResponse<never> = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    },
    meta: {
      requestId: reqId,
    }
  };
  return c.json(res, 404);
});

export default app;
