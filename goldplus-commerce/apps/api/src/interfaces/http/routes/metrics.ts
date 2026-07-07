import { Hono } from 'hono';
import * as client from 'prom-client';
import { QueueService, QUEUES } from '../../../infrastructure/queues/QueueService';
import { Registry } from '../../../infrastructure/Registry';
import { eventLoopLagMonitor } from '../../../infrastructure/observability/EventLoopLag';
import { containerMetricsCollector } from '../../../infrastructure/observability/ContainerMetricsCollector';

const routes = new Hono();
const OPTIONAL_METRICS_TIMEOUT_MS = 750;

// Enable default metrics collection (only once, checks if it's already registered to avoid errors)
try {
  client.collectDefaultMetrics();
} catch (err) {
  // Already registered or initialized, safe to ignore
}

// DB connection pool metrics
const dbConnectionsActive = new client.Gauge({
  name: 'goldplus_db_connections_active',
  help: 'Active database connections',
});

const dbConnectionsMax = new client.Gauge({
  name: 'goldplus_db_connections_max',
  help: 'Max database connections allowed',
});

const dbIdleInTx = new client.Gauge({
  name: 'goldplus_db_idle_in_transaction_connections',
  help: 'Number of database connections idle in transaction',
});

const dbLockWaiting = new client.Gauge({
  name: 'goldplus_db_lock_waiting_queries',
  help: 'Number of database queries waiting on locks',
});

const dbPreparedStatements = new client.Gauge({
  name: 'goldplus_db_prepared_statements_count',
  help: 'Number of active prepared statements',
});

const dbWalSize = new client.Gauge({
  name: 'goldplus_db_wal_size_bytes',
  help: 'Database WAL size in bytes',
});

const dbActiveReplicas = new client.Gauge({
  name: 'goldplus_db_active_replication_standbys',
  help: 'Number of active replication standby nodes',
});

// Queue metrics
const queueJobCount = new client.Gauge({
  name: 'goldplus_queue_jobs',
  help: 'Number of BullMQ jobs in queue grouped by name and status',
  labelNames: ['queue_name', 'status'],
});

const dbMetricsCollectionUp = new client.Gauge({
  name: 'goldplus_metrics_db_collection_up',
  help: 'Whether DB metrics collection succeeded on the last scrape (1 success, 0 degraded)',
});

const dbMetricsCollectionTimeoutTotal = new client.Counter({
  name: 'goldplus_metrics_db_collection_timeout_total',
  help: 'Number of DB metrics collections that timed out',
});

const queueMetricsCollectionUp = new client.Gauge({
  name: 'goldplus_metrics_queue_collection_up',
  help: 'Whether queue metrics collection succeeded on the last scrape (1 success, 0 degraded)',
});

const queueMetricsCollectionTimeoutTotal = new client.Counter({
  name: 'goldplus_metrics_queue_collection_timeout_total',
  help: 'Number of queue metrics collections that timed out',
});

const metricsCollectionDuration = new client.Histogram({
  name: 'goldplus_metrics_collection_duration_seconds',
  help: 'Duration of the metrics endpoint collection phase in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

// Event loop lag metrics
const eventLoopLagMean = new client.Gauge({
  name: 'goldplus_event_loop_lag_mean_ms',
  help: 'Mean event loop lag in milliseconds',
});

const eventLoopLagMax = new client.Gauge({
  name: 'goldplus_event_loop_lag_max_ms',
  help: 'Max event loop lag in milliseconds',
});

// Memory fragmentation metric
const memoryFragmentationRatio = new client.Gauge({
  name: 'goldplus_memory_fragmentation_ratio',
  help: 'Memory fragmentation ratio (heapUsed / heapTotal)',
});

// Register metrics (if not already registered)
const registerMetricSafe = (metric: client.Metric) => {
  try {
    client.register.registerMetric(metric);
  } catch (err) {
    // Metric already registered, ignore
  }
};

registerMetricSafe(dbConnectionsActive);
registerMetricSafe(dbConnectionsMax);
registerMetricSafe(dbIdleInTx);
registerMetricSafe(dbLockWaiting);
registerMetricSafe(dbPreparedStatements);
registerMetricSafe(dbWalSize);
registerMetricSafe(dbActiveReplicas);
registerMetricSafe(queueJobCount);
registerMetricSafe(dbMetricsCollectionUp);
registerMetricSafe(dbMetricsCollectionTimeoutTotal);
registerMetricSafe(queueMetricsCollectionUp);
registerMetricSafe(queueMetricsCollectionTimeoutTotal);
registerMetricSafe(metricsCollectionDuration);
registerMetricSafe(eventLoopLagMean);
registerMetricSafe(eventLoopLagMax);
registerMetricSafe(memoryFragmentationRatio);

class MetricsTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} metrics collection timed out after ${OPTIONAL_METRICS_TIMEOUT_MS}ms`);
    this.name = 'MetricsTimeoutError';
  }
}

type TimedMetricsResult<T> =
  | { ok: true; value: T; timedOut: false }
  | { ok: false; error: unknown; timedOut: boolean };

async function withOptionalMetricsTimeout<T>(
  label: string,
  task: Promise<T>,
): Promise<TimedMetricsResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MetricsTimeoutError(label)), OPTIONAL_METRICS_TIMEOUT_MS);
  });

  task.catch(() => undefined);

  try {
    const value = await Promise.race([task, timeout]);
    return { ok: true, value, timedOut: false };
  } catch (error) {
    return { ok: false, error, timedOut: error instanceof MetricsTimeoutError };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function setDefaultDbMetrics(): void {
  dbConnectionsActive.set(0);
  dbConnectionsMax.set(100);
  dbIdleInTx.set(0);
  dbLockWaiting.set(0);
  dbPreparedStatements.set(0);
  dbWalSize.set(0);
  dbActiveReplicas.set(0);
}

async function collectQueueMetrics(): Promise<void> {
  const queueService = QueueService.getInstance();
  const errors: unknown[] = [];

  await Promise.all(Object.values(QUEUES).map(async (queueName) => {
    try {
      const queue = queueService.getQueue(queueName);
      if (!queue) {
        queueJobCount.set({ queue_name: queueName, status: 'unavailable' }, 0);
        return;
      }

      const counts = await queue.getJobCounts();
      for (const [status, count] of Object.entries(counts)) {
        queueJobCount.set({ queue_name: queueName, status }, count);
      }
    } catch (err) {
      errors.push(err);
      queueJobCount.set({ queue_name: queueName, status: 'degraded' }, 0);
      console.error(`[Metrics] Error gathering metrics for queue ${queueName}:`, err);
    }
  }));

  if (errors.length > 0) {
    throw new Error(`Queue metrics degraded for ${errors.length} queue(s)`);
  }
}

routes.get('/', async (c) => {
  const collectionStartedAt = process.hrtime.bigint();

  // 0. Collect container metrics (CPU, Memory, File Descriptors, ELU)
  try {
    containerMetricsCollector.collect();
  } catch (err) {
    console.error('[Metrics] Error gathering container metrics:', err);
  }

  // 1. Fetch database connection metrics via SystemHealthUsecase
  const appRegistry = Registry.getInstance();
  const dbMetricsResult = await withOptionalMetricsTimeout(
    'DB',
    appRegistry.checkSystemHealthUseCase.execute(),
  );

  if (dbMetricsResult.ok) {
    const healthMetrics = dbMetricsResult.value;
    dbMetricsCollectionUp.set(1);

    if (healthMetrics.dbSaturation) {
      dbConnectionsActive.set(healthMetrics.dbSaturation.activeConnections);
      dbConnectionsMax.set(healthMetrics.dbSaturation.maxConnections);
    } else {
      dbConnectionsActive.set(0);
      dbConnectionsMax.set(100);
    }

    if (healthMetrics.dbAdditionalMetrics) {
      dbIdleInTx.set(healthMetrics.dbAdditionalMetrics.idleInTransactionConnections);
      dbLockWaiting.set(healthMetrics.dbAdditionalMetrics.lockWaitingQueries);
      dbPreparedStatements.set(healthMetrics.dbAdditionalMetrics.preparedStatementsCount);
      dbWalSize.set(healthMetrics.dbAdditionalMetrics.walSizeBytes);
      dbActiveReplicas.set(healthMetrics.dbAdditionalMetrics.activeReplicationStandbys);
    } else {
      dbIdleInTx.set(0);
      dbLockWaiting.set(0);
      dbPreparedStatements.set(0);
      dbWalSize.set(0);
      dbActiveReplicas.set(0);
    }
  } else {
    setDefaultDbMetrics();
    dbMetricsCollectionUp.set(0);
    if (dbMetricsResult.timedOut) {
      dbMetricsCollectionTimeoutTotal.inc();
    }
    console.error('[Metrics] DB metrics degraded:', dbMetricsResult.error);
  }

  // 2. Fetch queue sizes (job counts) from BullMQ
  const queueMetricsResult = await withOptionalMetricsTimeout('Queue', collectQueueMetrics());
  if (queueMetricsResult.ok) {
    queueMetricsCollectionUp.set(1);
  } else {
    queueMetricsCollectionUp.set(0);
    if (queueMetricsResult.timedOut) {
      queueMetricsCollectionTimeoutTotal.inc();
    }
    for (const queueName of Object.values(QUEUES)) {
      queueJobCount.set({ queue_name: queueName, status: 'degraded' }, 0);
    }
    console.error('[Metrics] Queue metrics degraded:', queueMetricsResult.error);
  }

  // 3. Monitor Event Loop Lag
  try {
    eventLoopLagMean.set(eventLoopLagMonitor.getLagMs());
    eventLoopLagMax.set(eventLoopLagMonitor.getMaxLagMs());
    eventLoopLagMonitor.reset();
  } catch (err) {
    console.error('[Metrics] Error gathering event loop metrics:', err);
  }

  // 4. Monitor Memory Fragmentation
  try {
    const memory = process.memoryUsage();
    memoryFragmentationRatio.set(memory.heapUsed / memory.heapTotal);
  } catch (err) {
    console.error('[Metrics] Error gathering memory metrics:', err);
  }

  // 5. Output in Prometheus metrics format
  metricsCollectionDuration.observe(Number(process.hrtime.bigint() - collectionStartedAt) / 1e9);
  c.header('Content-Type', client.register.contentType);
  return c.text(await client.register.metrics(), 200);
});

export default routes;
