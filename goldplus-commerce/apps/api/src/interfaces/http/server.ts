import '../../config/env';
import '../../infrastructure/observability/otel';
import * as Sentry from '@sentry/node';
import { logger } from '../../infrastructure/logging/logger';

export { logger };

// Initialize Error Tracking
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: 1.0,
});

import { serve } from '@hono/node-server';
import app from './app';

import { startOutboxTicker, gracefulStopOutboxTicker } from '../../infrastructure/scheduler/OutboxTicker';
import { startLoyaltyDailyTicker, stopLoyaltyDailyTicker } from '../../infrastructure/scheduler/LoyaltyDailyTicker';
import { startPaymentReconcileTicker, stopPaymentReconcileTicker } from '../../infrastructure/scheduler/PaymentReconcileTicker';
import { runPermissionRegistrySyncAtBoot } from '../../infrastructure/security/PermissionRegistrySync';
import { runHeroSlideSeedAtBoot } from '../../infrastructure/hero/HeroSlideSeeder';
import { templateOverrideCache } from '../../infrastructure/notifications/TemplateOverrideCache';
import { endDbConnection } from '../../infrastructure/db/client';
import { QueueService } from '../../infrastructure/queues/QueueService';
import { registerAllWorkers } from '../../infrastructure/queues/QueueWorkers';
import { beginDraining } from './lifecycle';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

console.log(`Starting GoldPlus API Server on port ${port}...`);

const server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  logger.info(`Server is running at http://localhost:${info.port}`);

  if (process.env.NODE_ENV !== 'test') {
    startOutboxTicker();
    startLoyaltyDailyTicker();
  // The payment safety net: polls the provider for every attempt still
  // non-terminal past the threshold. Must run even when callbacks work.
  startPaymentReconcileTicker();
    registerAllWorkers();
    // Converge DB permissions on the code registry (advisory-locked, add-only).
    void runPermissionRegistrySyncAtBoot();
    // Ensure the hero library exists (idempotent, add-only, never overwrites edits).
    void runHeroSlideSeedAtBoot();
    // Notification wording overrides: load published rows now, refresh every minute.
    templateOverrideCache.start();
  }
});

// ---------------------------------------------------------------------------
// Graceful Shutdown & Error Handling
// ---------------------------------------------------------------------------

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`\n[Process] Received ${signal}. Initiating graceful shutdown...`);

  // Slice 3F: flip readiness to false FIRST, then pause briefly so at least one
  // load-balancer health poll observes 503 and drains this instance before we
  // start closing sockets. Liveness stays true throughout.
  beginDraining();
  const drainMs = Number(process.env.SHUTDOWN_DRAIN_MS ?? 3000);
  if (drainMs > 0) {
    logger.info(`[Process] Draining: readiness is now false. Waiting ${drainMs}ms for load balancer.`);
    await new Promise((resolve) => setTimeout(resolve, drainMs));
  }

  // Wait for HTTP connections to close and outbox batch to finish
  const timeoutId = setTimeout(() => {
    logger.fatal('[Process] Forcefully terminating due to shutdown timeout.');
    process.exit(1);
  }, 15000);

  try {
    logger.info('[Process] Stopping HTTP server...');
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          logger.error({ err }, '[Process] Error closing HTTP server');
        } else {
          logger.info('[Process] HTTP server stopped.');
        }
        resolve();
      });
    });

    logger.info('[Process] Waiting for background tasks to finish...');
    stopLoyaltyDailyTicker();
  stopPaymentReconcileTicker();
    await gracefulStopOutboxTicker(10000);

    logger.info('[Process] Closing database connections...');
    await endDbConnection();

    logger.info('[Process] Closing message queue connections...');
    await QueueService.getInstance().closeAll();

    logger.info('[Process] Shutdown complete.');
    clearTimeout(timeoutId);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '[Process] Error during graceful shutdown:');
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  logger.fatal({ err }, '[Process] UNCAUGHT EXCEPTION! Shutting down gracefully.');
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  Sentry.captureException(reason);
  logger.fatal({ reason }, '[Process] UNHANDLED REJECTION! Shutting down gracefully.');
  gracefulShutdown('unhandledRejection');
});
