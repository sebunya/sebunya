import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { rateLimiter } from './middleware/rateLimiter';
import { logger as pinoLogger } from 'hono-pino';
import { ApiResponse } from '@goldplus/shared';
import { logger } from '../../infrastructure/logging/logger';
import * as Sentry from '@sentry/node';
import { traceLocalStorage } from '../../infrastructure/observability/TraceContext';
import { randomUUID } from 'node:crypto';
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
import adminRecommendationsRoutes from './routes/admin/recommendations';
import adminQueuesRoutes from './routes/admin/queues';
import adminDeploymentRoutes from './routes/admin/deployment';
import recommendationRoutes from './routes/recommendations';
import telemetryRoutes from './routes/telemetry';
import healthRoutes from './routes/health';
import metricsRoutes from './routes/metrics';
import consentRoutes from './routes/consent';
import measurementRoutes from './routes/measurement';
import adminMeasurementRoutes from './routes/admin/measurement';
import { measurementGtmRoutes } from './routes/admin/measurement-gtm';
import measurementControlTowerRoutes from './routes/admin/measurement-control-tower';
import { releaseReadinessAdminRouter } from './routes/admin/release-readiness';
import { productFinderRoutes } from './routes/product-finder';
import { maintenanceMode } from './middleware/maintenance';
import { deploymentService } from '../../infrastructure/deployment/DeploymentService';
import { controlledActivationDryRunRouter } from '../../presentation/routes/controlled-activation-dry-run.js';
import { liveReview } from '../../presentation/routes/controlled-activation-live-review';
import { controlledLiveCanaryRouter } from '../../presentation/routes/controlled-live-canary.js';
import consentOperatingRoutes from './routes/consent-operating';
import adminConsentOperatingRoutes from './routes/admin/consent-operating';



// Define typed variables for the Hono context
type Variables = {
  requestId: string;
};

const app = new Hono<{ Variables: Variables }>();

function createRequestId(): string {
  return randomUUID ? randomUUID() : Math.random().toString(36).substring(2, 15);
}

// Global Middleware
app.use('*', cors());

// Request ID & Tracing Context Middleware
app.use('*', async (c, next) => {
  let reqId = c.req.header('x-correlation-id') || c.req.header('x-request-id') || c.get('requestId');
  if (!reqId) {
    reqId = createRequestId();
  }

  c.set('requestId', reqId);
  c.header('X-Correlation-Id', reqId);
  c.header('X-Request-Id', reqId);

  const userId = c.req.header('x-user-id') || undefined;

  return traceLocalStorage.run({ traceId: reqId, userId }, async () => {
    await next();
  });
});

// Use Pino for structured request logging
app.use('*', pinoLogger({
  pino: logger,
  http: {
    reqId: () => createRequestId(),
  },
}));

app.use('/telemetry/collect', rateLimiter({ limit: 100, windowMs: 1000 }));
app.use('*', rateLimiter({ limit: 1000, windowMs: 60 * 1000 }));
app.use('*', maintenanceMode);

// Shadow Traffic Middleware
app.use('*', async (c, next) => {
  const shadowRatio = deploymentService.getShadowTrafficRatio();
  if (shadowRatio > 0 && c.req.header('X-Shadow-Request') !== 'true') {
    const method = c.req.method.toUpperCase();
    const isExempted =
      c.req.path.startsWith('/health') ||
      c.req.path.startsWith('/metrics') ||
      c.req.path.includes('/admin/deployment') ||
      c.req.path.includes('/admin/queues');

    if (!isExempted) {
      try {
        const bodyStr = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
          ? await c.req.raw.clone().text()
          : null;

        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((value, key) => {
          headers[key] = value;
        });

        deploymentService.mirrorTrafficIfSelected(
          c.req.url,
          c.req.method,
          headers,
          bodyStr
        );
      } catch (err) {
        logger.debug({ err }, '[ShadowTraffic] Failed to clone request for mirroring');
      }
    }
  }
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
app.route('/admin/recommendations', adminRecommendationsRoutes);
app.route('/admin/queues', adminQueuesRoutes);
app.route('/admin/deployment', adminDeploymentRoutes);
app.route('/recommendations', recommendationRoutes);
app.route('/telemetry', telemetryRoutes);
app.route('/health', healthRoutes);
app.route('/metrics', metricsRoutes);
app.route('/consent', consentRoutes);
app.route('/measurement', measurementRoutes);
app.route('/admin/measurement', adminMeasurementRoutes);
app.route('/admin/measurement/gtm', measurementGtmRoutes);
app.route('/admin/measurement-control-tower', measurementControlTowerRoutes);
app.route('/admin/release-readiness', releaseReadinessAdminRouter);
app.route('/admin/controlled-activation-dry-run', controlledActivationDryRunRouter);
app.route('/admin/controlled-activation-live-review', liveReview);
app.route('/admin/controlled-activation/live-canaries', controlledLiveCanaryRouter);
app.route('/product-finder', productFinderRoutes);
app.route('/account/consent-operating', consentOperatingRoutes);
app.route('/admin/consent-operating', adminConsentOperatingRoutes);


// Health check route mounted via route registration

// Error Handling
app.onError((err, c) => {
  logger.error({ err }, `[ERROR] ${err.message}`);
  Sentry.captureException(err);
  
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
