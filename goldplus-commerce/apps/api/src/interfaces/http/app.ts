import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ApiResponse } from '@goldplus/shared';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import commerceRoutes from './routes/commerce';
import governanceRoutes from './routes/governance';
import webhookRoutes from './routes/webhooks';
import accountRoutes from './routes/account';
import adminAuditRoutes from './routes/admin/audit';
import adminUsersRoutes from './routes/admin/users';
import adminRolesRoutes from './routes/admin/roles';
import adminProductsRoutes from './routes/admin/products';
import adminNotificationsRoutes from './routes/admin/notifications';
import adminExperimentsRoutes from './routes/admin/experiments';
import adminAnalyticsRoutes from './routes/admin/analytics';
import eventsRoutes from './routes/events';


// Define typed variables for the Hono context
type Variables = {
  requestId: string;
};

const app = new Hono<{ Variables: Variables }>();

// Global Middleware
app.use('*', cors());
app.use('*', logger());

// Request ID Middleware — must be registered before routes so every
// handler and error response carries a requestId.
app.use('*', async (c, next) => {
  const reqId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
  c.set('requestId', reqId);
  await next();
});

// Routes
app.route('/auth', authRoutes);
app.route('/products', productRoutes);
app.route('/commerce', commerceRoutes);
app.route('/governance', governanceRoutes);
app.route('/webhooks', webhookRoutes);
app.route('/account', accountRoutes);
app.route('/admin/audit', adminAuditRoutes);
app.route('/admin/users', adminUsersRoutes);
app.route('/admin/roles', adminRolesRoutes);
app.route('/admin/products', adminProductsRoutes);
app.route('/admin/notifications', adminNotificationsRoutes);
app.route('/admin/experiments', adminExperimentsRoutes);
app.route('/admin/analytics', adminAnalyticsRoutes);
app.route('/events', eventsRoutes);


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
  
  // Detect database connection issues to deliver typed fallback requirement
  const isDbError = err.message?.includes('ECONNREFUSED') || err.message?.includes('DATABASE_URL') || !process.env.DATABASE_URL;
  
  if (isDbError) {
    const dbRes: ApiResponse<never> = {
      success: false,
      error: {
        code: 'DB_NOT_CONFIGURED',
        message: 'Service temporarily offline: The persistent layer is unconfigured.',
      },
      meta: {
        requestId: c.get('requestId') as string,
      }
    };
    return c.json(dbRes, 503);
  }

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
