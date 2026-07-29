import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { env } from '../../../config/env';
import { ApiResponse } from '@goldplus/shared';
import { QueueService } from '../../../infrastructure/queues/QueueService';
import { proxyConfig } from '../clientAddress';
import { abuseControlStore } from '../../../infrastructure/security/RedisAbuseControlStore';

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
  // Two distinct questions, deliberately not collapsed into one flag:
  //   overallHealthy — can this instance serve at all? (false ⇒ take it out)
  //   degraded       — is something impaired but still serveable? (keep traffic)
  let overallHealthy = true;
  let degraded = false;

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

  // Redis: DEGRADED, not unready.
  //
  // Readiness answers "should the load balancer send traffic here", and the
  // answer when Redis is down is still yes. HTTP reads and writes work, the
  // outbox lives in PostgreSQL, and the abuse controls fall back to their
  // documented local policy. Reporting unready would pull EVERY replica out of
  // rotation at the same instant, because they all see the same Redis — turning
  // a cache outage into a total site outage, which is strictly worse than the
  // degradation it was reacting to.
  //
  // PostgreSQL is different and stays fatal above: without it the service
  // genuinely cannot answer.
  const queueService = QueueService.getInstance();
  const redisHealthy = queueService.isHealthy();
  subsystems.redis = {
    status: redisHealthy ? 'healthy' : 'degraded',
    ...(redisHealthy ? {} : { error: 'QUEUES_UNAVAILABLE_BACKGROUND_WORK_DELAYED' }),
  };
  if (!redisHealthy) degraded = true;

  // Proxy topology. Every per-client abuse control depends on knowing how the
  // service is exposed, so a service that cannot answer that is not ready. The
  // mode and hop count are reported; no hostnames, addresses or network detail.
  try {
    const proxy = proxyConfig();
    subsystems.proxy_topology = {
      status: 'healthy',
      mode: proxy.mode,
      trusted_hops: proxy.trustedHops,
    } as never;
  } catch (err) {
    overallHealthy = false;
    subsystems.proxy_topology = {
      status: 'unhealthy',
      error: 'PROXY_TOPOLOGY_INVALID',
    };
  }

  // Abuse controls. Redis holds the authoritative counters; a degraded control
  // is still enforcing, but on a stricter per-replica budget, so it is reported
  // rather than hidden behind an overall "ready".
  const abuse = await abuseControlStore.probe();
  const abuseDegraded = !abuse.available || abuse.degraded;
  subsystems.abuse_controls = {
    status: abuseDegraded ? 'degraded' : 'healthy',
    ...(abuse.available ? {} : { error: 'REDIS_UNAVAILABLE_LOCAL_FALLBACK_ACTIVE' }),
  };
  if (abuseDegraded) degraded = true;

  const res: ApiResponse<{ status: string; timestamp: string; subsystems: typeof subsystems }> = {
    success: overallHealthy,
    data: {
      // 'degraded' is reported truthfully AND still serves traffic. Collapsing
      // it into 'ready' would hide a real impairment from operators; collapsing
      // it into 'unready' would take the site down over a recoverable one.
      status: overallHealthy ? (degraded ? 'degraded' : 'ready') : 'unready',
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

  // 3b. Outbox operating state.
  //
  // Lag alone does not say whether anything is stuck or lost. Dead letters are
  // events that were NEVER DELIVERED — until migration 0054 they were recorded
  // as 'processed' and were invisible here. An expired lease is a worker that
  // claimed an event and never came back.
  if (subsystems.postgres.status === 'healthy') {
    try {
      const outbox = await Registry.getInstance().outboxRepo.metrics?.();
      if (outbox) {
        const stuck = outbox.expiredLeases > 0;
        subsystems.outbox_operations = {
          status: outbox.deadLettered > 0 || stuck ? 'degraded' : 'healthy',
          pending: outbox.pending,
          due: outbox.due,
          processing: outbox.processing,
          dead_lettered: outbox.deadLettered,
          expired_leases: outbox.expiredLeases,
          oldest_pending_age_seconds: outbox.oldestPendingAgeSeconds,
        } as never;
        if (subsystems.outbox_operations.status === 'degraded' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      }
    } catch (err) {
      subsystems.outbox_operations = { status: 'unknown', error: errorMessage(err) };
    }
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
