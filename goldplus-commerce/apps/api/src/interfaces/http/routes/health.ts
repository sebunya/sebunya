import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { env } from '../../../config/env';
import { ApiResponse } from '@goldplus/shared';
import { QueueService } from '../../../infrastructure/queues/QueueService';

const routes = new Hono();

type HealthSubsystem = {
  status: string;
  latency_ms?: number;
  error?: string;
  active_connections?: number;
  max_connections?: number;
  lag_ms?: number;
  has_pending_events?: boolean;
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function livenessResponse(): ApiResponse<{ status: string; timestamp: string }> {
  return {
    success: true,
    data: { status: 'alive', timestamp: new Date().toISOString() },
  };
}

// ------------------------------------------------------------------------------
// 1. LIVENESS — /health and /health/live
// ------------------------------------------------------------------------------
routes.get('/', (c) => {
  return c.json(livenessResponse(), 200);
});

routes.get('/live', (c) => {
  return c.json(livenessResponse(), 200);
});

// ------------------------------------------------------------------------------
// 2. READINESS — /health/ready
// ------------------------------------------------------------------------------
routes.get('/ready', async (c) => {
  const subsystems: Record<string, { status: string; latency_ms?: number; error?: string }> = {};
  let overallHealthy = true;

  const registry = Registry.getInstance();
  const healthMetrics = await registry.checkSystemHealthUseCase.execute();

  // Check Database Connectivity from ports
  if (healthMetrics.postgresError) {
    overallHealthy = false;
    subsystems.postgres = {
      status: 'unhealthy',
      error: healthMetrics.postgresError,
    };
  } else {
    subsystems.postgres = {
      status: 'healthy',
      latency_ms: healthMetrics.postgresLatencyMs,
    };
  }

  // Check Configuration Sanity
  const zeptoMailToken = process.env.ZEPTOMAIL_API_TOKEN;
  const smsApiKey = process.env.SMS_API_KEY;
  subsystems.zeptomail_config = { status: zeptoMailToken ? 'configured' : 'not_configured' };
  subsystems.sms_config = { status: smsApiKey ? 'configured' : 'not_configured' };

  // Check Redis Queue Health
  const queueService = QueueService.getInstance();
  const redisHealthy = queueService.isHealthy();
  subsystems.redis = { status: redisHealthy ? 'healthy' : 'unhealthy' };
  if (!redisHealthy) {
    overallHealthy = false;
  }

  const res: ApiResponse<{ status: string; timestamp: string; subsystems: typeof subsystems }> = {
    success: overallHealthy,
    data: {
      status: overallHealthy ? 'ready' : 'unready',
      timestamp: new Date().toISOString(),
      subsystems,
    },
  };

  return c.json(res, overallHealthy ? 200 : 503);
});

// ------------------------------------------------------------------------------
// 3. DEEP HEALTH — /health/deep
// ------------------------------------------------------------------------------
routes.get('/deep', async (c) => {
  const subsystems: Record<string, HealthSubsystem> = {};
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  const start = Date.now();

  const registry = Registry.getInstance();
  const healthMetrics = await registry.checkSystemHealthUseCase.execute();

  // 1. Database Connection and Latency
  if (healthMetrics.postgresError) {
    overallStatus = 'unhealthy';
    subsystems.postgres = { status: 'unhealthy', error: healthMetrics.postgresError };
  } else {
    subsystems.postgres = { status: 'healthy', latency_ms: healthMetrics.postgresLatencyMs };
  }

  // 2. Database Saturation Analysis
  if (subsystems.postgres.status === 'healthy' && healthMetrics.dbSaturation) {
    subsystems.db_saturation = {
      status: healthMetrics.dbSaturation.status,
      active_connections: healthMetrics.dbSaturation.activeConnections,
      max_connections: healthMetrics.dbSaturation.maxConnections,
    };
    if (healthMetrics.dbSaturation.status === 'warning' && overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }
  } else if (healthMetrics.postgresError) {
    subsystems.db_saturation = { status: 'unknown', error: healthMetrics.postgresError };
  }

  // 3. Outbox Lag Analysis
  if (subsystems.postgres.status === 'healthy' && healthMetrics.outboxLagMs !== undefined) {
    const lagMs = healthMetrics.outboxLagMs;
    subsystems.outbox_queue = {
      status: lagMs > 300_000 ? 'degraded' : 'healthy', // degraded if older than 5 minutes
      lag_ms: lagMs,
      has_pending_events: lagMs > 0,
    };
    if (lagMs > 300_000 && overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }
  } else if (healthMetrics.postgresError) {
    subsystems.outbox_queue = { status: 'unknown', error: healthMetrics.postgresError };
  }

  // Redis Queue Health
  const queueService = QueueService.getInstance();
  const redisHealthy = queueService.isHealthy();
  subsystems.redis = { status: redisHealthy ? 'healthy' : 'unhealthy' };
  if (!redisHealthy && overallStatus === 'healthy') {
    overallStatus = 'degraded';
  }

  // 4. sGTM Upstream Reachability
  const startSgtm = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2-second timeout
    const response = await fetch(`${env.metricsInternalUrl}/healthy`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      subsystems.external_sgtm = {
        status: 'healthy',
        latency_ms: Date.now() - startSgtm,
      };
    } else {
      if (overallStatus === 'healthy') overallStatus = 'degraded';
      subsystems.external_sgtm = {
        status: 'degraded',
        error: `sGTM returned status ${response.status}`,
        latency_ms: Date.now() - startSgtm,
      };
    }
  } catch (err: unknown) {
    if (overallStatus === 'healthy') overallStatus = 'degraded';
    subsystems.external_sgtm = {
      status: 'offline',
      error: err instanceof Error && err.name === 'AbortError' ? 'Timeout' : errorMessage(err),
    };
  }

  const durationMs = Date.now() - start;
  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  const res: ApiResponse<{
    status: typeof overallStatus;
    timestamp: string;
    duration_ms: number;
    subsystems: typeof subsystems;
  }> = {
    success: overallStatus !== 'unhealthy',
    data: {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      subsystems,
    },
  };

  return c.json(res, statusCode);
});

export default routes;
