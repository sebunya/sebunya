import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { publicAbuseControl } from './middleware/publicAbuseControl';
import { csrf } from './middleware/csrf';
import { mapErrorToHttp } from './errorMapping';
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
import adminProductCostsRoutes from './routes/admin/product-costs';
import adminHeroRoutes from './routes/admin/hero';
import heroPublicRoutes from './routes/hero';
import adminNavRoutes from './routes/admin/nav';
import navPublicRoutes from './routes/nav';
import adminBusinessInfoRoutes from './routes/admin/business-info';
import adminTaxonomyRoutes from './routes/admin/taxonomy';
import adminHomepageRoutes from './routes/admin/homepage';
import authSocialRoutes from './routes/auth-social';
import adminNotificationsRoutes from './routes/admin/notifications';
import adminRecommendationsRoutes from './routes/admin/recommendations';
import adminCustomerDnaRoutes from './routes/admin/customer-dna';
import adminDecisionIntelligenceRoutes from './routes/admin/decision-intelligence';
import adminQueuesRoutes from './routes/admin/queues';
import adminDeploymentRoutes from './routes/admin/deployment';
import adminDeliveryZonesRoutes from './routes/admin/delivery-zones';
import adminSearchDemandRoutes from './routes/admin/search-demand';
import adminAnalyticsRoutes from './routes/admin/analytics';
import adminCompatibilityRoutes from './routes/admin/compatibility';
import adminNewModulesRoutes from './routes/admin/new-modules';
import adminMediaRoutes from './routes/admin/media';
import adminLegalRoutes from './routes/admin/legal';
import adminCartsRoutes from './routes/admin/carts';
import adminOrdersActionRoutes from './routes/admin/orders';
import adminCampaignsRoutes from './routes/admin/campaigns';
import publicLegalRoutes from './routes/legal';
import adminLoyaltyRoutes from './routes/admin/loyalty';
import adminFulfilmentRoutes from './routes/admin/fulfilment';
import adminControlCentreRoutes, { registerMountedPrefixes } from './routes/admin/control-centre';
import adminInventoryRoutes from './routes/admin/inventory';
import recommendationRoutes from './routes/recommendations';
import telemetryRoutes from './routes/telemetry';
import healthRoutes from './routes/health';
import metricsRoutes from './routes/metrics';
import consentRoutes from './routes/consent';
import measurementRoutes from './routes/measurement';
import adminMeasurementRoutes from './routes/admin/measurement';
import { measurementGtmRoutes } from './routes/admin/measurement-gtm';
import { controlledActivationRoutes } from './routes/admin/controlled-activation';
import measurementPaidSocialRoutes from './routes/admin/measurement-paid-social';
import measurementPaymentsRoutes from './routes/admin/measurement-payments';
import measurementControlTowerRoutes from './routes/admin/measurement-control-tower';
import { releaseReadinessAdminRouter } from './routes/admin/release-readiness';
import { productFinderRoutes } from './routes/product-finder';
import locationRoutes from './routes/locations';
import adminLocationRoutes from './routes/admin/locations';
import adminDeliveryRoutes from './routes/admin/delivery';
import adminPaymentsRoutes from './routes/admin/payments';
import deliveryQuoteRoutes from './routes/delivery';
import { maintenanceMode } from './middleware/maintenance';
import { deploymentService } from '../../infrastructure/deployment/DeploymentService';
import { controlledActivationDryRunRouter } from '../../presentation/routes/controlled-activation-dry-run.js';
import { liveReview } from '../../presentation/routes/controlled-activation-live-review';
import { controlledLiveCanaryRouter } from '../../presentation/routes/controlled-live-canary.js';
import consentOperatingRoutes from './routes/consent-operating';
import adminConsentOperatingRoutes from './routes/admin/consent-operating';
import adminConsentOperationsRoutes from './routes/admin/consent-operations';
import adminAutomationRoutes from './routes/admin/automation';
import adminExperimentRoutes from './routes/admin/experiments';
import adminPricingRoutes from './routes/admin/pricing';
import adminFraudRoutes from './routes/admin/fraud';
import adminPimImportRoutes from './routes/admin/pim-imports';
import adminSurveyRoutes from './routes/admin/surveys';
import surveyRoutes from './routes/surveys';
import adminCopyQualityRoutes from './routes/admin/copy-quality';
import adminBehaviouralInterventionRoutes from './routes/admin/behavioural-interventions';
import behaviouralInterventionRoutes from './routes/behavioural-interventions';



// Define typed variables for the Hono context
type Variables = {
  requestId: string;
};

const app = new Hono<{ Variables: Variables }>();

function createRequestId(): string {
  return randomUUID ? randomUUID() : Math.random().toString(36).substring(2, 15);
}

// Global Middleware.
//
// CORS honours CORS_ORIGIN (the deployment already sets it) instead of the
// wide-open default: the API was replying `Access-Control-Allow-Origin: *` to
// every origin while the operator's configured allowlist sat unread — a config
// that lies. Requests without an Origin header (server-to-server, provider
// webhooks, curl) are unaffected; the www. counterpart of each configured origin
// is accepted so an edge redirect cannot strand the storefront. With no
// CORS_ORIGIN set, no cross-origin browser access is granted.
const CORS_ALLOWLIST: string[] = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean)
  .flatMap((o) => (/^https?:\/\/www\./.test(o) ? [o] : [o, o.replace(/^(https?:\/\/)/, '$1www.')]));

app.use(
  '*',
  cors({
    origin: (origin) => (CORS_ALLOWLIST.includes(origin) ? origin : null),
  }),
);

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

// Slice 3A: one authoritative Redis-backed abuse-control layer for every public
// endpoint family. It classifies each request into a stable route family and
// keys the counter on that family — never the raw path — so attacker path
// variation cannot mint unbounded budgets, which the previous per-path `global`
// limiter allowed. Per-family limits (login 10/min, cart 120/min, telemetry
// 100/s, the public forms, provider webhooks, and a single shared global) live
// in domain/security/PublicEndpointPolicy.ts, along with each family's Redis-
// outage risk policy and a correct Retry-After.
app.use('*', publicAbuseControl());
// Slice 3B: CSRF defence for cookie-authenticated mutations. No-ops for safe
// methods, Bearer/no-cookie requests and provider webhooks; blocks a
// state-changing cookie-authenticated request whose Origin/Referer is not an
// allowlisted web origin. See domain/security/CsrfPolicy.ts.
app.use('*', csrf());
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
app.route('/auth/social', authSocialRoutes);
app.route('/products', productRoutes);
app.route('/commerce', commerceRoutes);
app.route('/governance', governanceRoutes);
app.route('/webhooks', webhookRoutes);
app.route('/account', accountRoutes);
app.route('/admin/audit', adminAuditRoutes);
app.route('/admin/users', adminUsersRoutes);
app.route('/admin/roles', adminRolesRoutes);
app.route('/admin/products', adminProductsRoutes);
app.route('/admin/product-costs', adminProductCostsRoutes);
app.route('/admin/hero', adminHeroRoutes);
app.route('/admin/nav', adminNavRoutes);
app.route('/admin/business-info', adminBusinessInfoRoutes);
app.route('/admin/taxonomy', adminTaxonomyRoutes);
app.route('/admin/homepage', adminHomepageRoutes);
app.route('/admin/notifications', adminNotificationsRoutes);
app.route('/admin/recommendations', adminRecommendationsRoutes);
app.route('/admin/customer-dna', adminCustomerDnaRoutes);
app.route('/admin/decision-intelligence', adminDecisionIntelligenceRoutes);
app.route('/admin/queues', adminQueuesRoutes);
app.route('/admin/deployment', adminDeploymentRoutes);
app.route('/admin/delivery-zones', adminDeliveryZonesRoutes);
app.route('/admin/search-demand', adminSearchDemandRoutes);
app.route('/admin/analytics', adminAnalyticsRoutes);
app.route('/admin/compatibility', adminCompatibilityRoutes);
app.route('/admin/modules', adminNewModulesRoutes);
app.route('/admin/media', adminMediaRoutes);
app.route('/admin/legal', adminLegalRoutes);
app.route('/admin/carts', adminCartsRoutes);
app.route('/admin/orders', adminOrdersActionRoutes);
app.route('/admin/campaigns', adminCampaignsRoutes);
app.route('/legal', publicLegalRoutes);
app.route('/admin/loyalty', adminLoyaltyRoutes);
app.route('/admin/fulfilment', adminFulfilmentRoutes);
app.route('/admin/inventory', adminInventoryRoutes);
app.route('/admin/control-centre', adminControlCentreRoutes);
app.route('/recommendations', recommendationRoutes);
app.route('/hero', heroPublicRoutes);
app.route('/nav', navPublicRoutes);
app.route('/telemetry', telemetryRoutes);
app.route('/health', healthRoutes);
app.route('/metrics', metricsRoutes);
app.route('/consent', consentRoutes);
app.route('/measurement', measurementRoutes);
app.route('/admin/measurement', adminMeasurementRoutes);
app.route('/admin/measurement/gtm', measurementGtmRoutes);
app.route('/admin/measurement/paid-social', measurementPaidSocialRoutes);
app.route('/admin/measurement/payments', measurementPaymentsRoutes);
app.route('/admin/measurement-control-tower', measurementControlTowerRoutes);
app.route('/admin/release-readiness', releaseReadinessAdminRouter);
app.route('/admin/controlled-activation-dry-run', controlledActivationDryRunRouter);
app.route('/admin/controlled-activation-live-review', liveReview);
app.route('/admin/controlled-activation/live-canaries', controlledLiveCanaryRouter);
// Registered after /live-canaries so the more specific mount keeps priority.
app.route('/admin/controlled-activation', controlledActivationRoutes);
app.route('/product-finder', productFinderRoutes);
app.route('/locations', locationRoutes);
app.route('/delivery', deliveryQuoteRoutes);
app.route('/admin/locations', adminLocationRoutes);
app.route('/admin/delivery', adminDeliveryRoutes);
app.route('/admin/payments', adminPaymentsRoutes);
app.route('/account/consent-operating', consentOperatingRoutes);
app.route('/admin/consent-operating', adminConsentOperatingRoutes);
app.route('/api/admin/consent/operations', adminConsentOperationsRoutes);
app.route('/admin/automation', adminAutomationRoutes);
app.route('/admin/experiments', adminExperimentRoutes);
app.route('/admin/pricing', adminPricingRoutes);
app.route('/admin/fraud', adminFraudRoutes);
app.route('/admin/pim-imports', adminPimImportRoutes);
app.route('/admin/surveys', adminSurveyRoutes);
app.route('/account/surveys', surveyRoutes);
app.route('/admin/copy-quality', adminCopyQualityRoutes);
app.route('/admin/behavioural-interventions', adminBehaviouralInterventionRoutes);
app.route('/account/behavioural-interventions', behaviouralInterventionRoutes);


// Health check route mounted via route registration

// Error Handling
app.onError((err, c) => {
  // Server-side: keep the full error for diagnosis (the logger redacts PII/
  // secrets). Client-side: the central mapper decides the status and a SAFE
  // message — an unexpected error never returns err.message, and DB failures are
  // classified by SQLSTATE code, not by matching the message string.
  const requestId = c.get('requestId') as string | undefined;
  logger.error({ err, requestId }, '[ERROR] request failed');
  Sentry.captureException(err);
  const mapped = mapErrorToHttp(err, requestId);
  return c.json(mapped.body as ApiResponse<never>, mapped.status);
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

// The Control Centre readiness service must know what is genuinely mounted, so the
// list is derived from this file at build time by scripts/release/claude/… rather
// than hand-maintained. Registering it here keeps the probe honest: a router that
// is removed or never mounted makes its module report UNAVAILABLE.

/** Every API prefix mounted below. Kept in step by tests/architecture/control-centre-route-coverage.test.ts. */
export const MOUNTED_API_PREFIXES: readonly string[] = [
  '/admin/hero',
  '/hero',
  '/admin/nav',
  '/admin/business-info',
  '/admin/taxonomy',
  '/admin/homepage',
  '/nav',
  '/auth/social',
  '/admin/product-costs',
  '/account',
  '/account/behavioural-interventions',
  '/account/consent-operating',
  '/account/surveys',
  '/admin/analytics',
  '/admin/audit',
  '/admin/automation',
  '/admin/behavioural-interventions',
  '/admin/campaigns',
  '/admin/carts',
  '/admin/compatibility',
  '/admin/consent-operating',
  '/admin/control-centre',
  '/admin/controlled-activation',
  '/admin/controlled-activation-dry-run',
  '/admin/controlled-activation-live-review',
  '/admin/controlled-activation/live-canaries',
  '/admin/copy-quality',
  '/admin/customer-dna',
  '/admin/decision-intelligence',
  '/admin/delivery-zones',
  '/admin/deployment',
  '/admin/experiments',
  '/admin/fraud',
  '/admin/fulfilment',
  '/admin/inventory',
  '/admin/legal',
  '/admin/loyalty',
  '/admin/measurement',
  '/admin/measurement-control-tower',
  '/admin/measurement/gtm',
  '/admin/measurement/paid-social',
  '/admin/measurement/payments',
  '/admin/media',
  '/admin/modules',
  '/admin/notifications',
  '/admin/orders',
  '/admin/pim-imports',
  '/admin/pricing',
  '/admin/products',
  '/admin/queues',
  '/admin/recommendations',
  '/admin/release-readiness',
  '/admin/roles',
  '/admin/search-demand',
  '/admin/surveys',
  '/admin/users',
  '/api/admin/consent/operations',
  '/auth',
  '/commerce',
  '/consent',
  '/governance',
  '/health',
  '/legal',
  '/measurement',
  '/metrics',
  '/product-finder',
  '/locations',
  '/delivery',
  '/admin/locations',
  '/admin/delivery',
  '/admin/payments',
  '/products',
  '/recommendations',
  '/telemetry',
  '/webhooks',
] as const;

registerMountedPrefixes(MOUNTED_API_PREFIXES);

