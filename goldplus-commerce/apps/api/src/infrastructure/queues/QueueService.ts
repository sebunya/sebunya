import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../logging/logger';
import { traceLocalStorage } from '../observability/TraceContext';
import { dbQueryDurations } from '../db/client';
import { eventLoopLagMonitor } from '../observability/EventLoopLag';
import * as client from 'prom-client';

export const queueJobWaitTime = new client.Histogram({
  name: 'goldplus_queue_job_wait_seconds',
  help: 'Queue job wait time in seconds (lag between enqueue and processing start)',
  labelNames: ['queue_name'],
  buckets: [0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
});

export const queueJobDuration = new client.Histogram({
  name: 'goldplus_queue_job_duration_seconds',
  help: 'Queue job execution duration in seconds',
  labelNames: ['queue_name', 'status'],
  buckets: [0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30],
});

try {
  client.register.registerMetric(queueJobWaitTime);
  client.register.registerMetric(queueJobDuration);
} catch (err) {
  // Already registered
}

export const QUEUES = {
  TELEMETRY_DISPATCH: 'telemetry-dispatch',
  TELEMETRY_REPLAY: 'telemetry-replay',
  WEBHOOK_RETRIES: 'webhook-retries',
  RECOMMENDATION_PROCESSING: 'recommendation-processing',
  ANALYTICS_FANOUT: 'analytics-fanout',
  INVENTORY_SYNC: 'inventory-sync',
  EMAIL_JOBS: 'email-jobs',
  ABANDONED_CART_EVENTS: 'abandoned-cart-events',
  RECOMMENDATION_MATERIALIZATION: 'recommendation-materialization',
} as const;

export type QueueName = typeof QUEUES[keyof typeof QUEUES];

export interface QueueRuntimeStatus {
  queueName: string;
  redisStatus: string;
  queueAvailable: boolean;
  worker: {
    registered: boolean;
    concurrency: number | null;
  };
  counts: Record<string, number> | null;
  degradedReason?: string;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class QueueService {
  private static _instance: QueueService;
  private redisConnection: Redis | null = null;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();

  private backpressureTimer: NodeJS.Timeout | null = null;

  private constructor() {
    const isTest = process.env.NODE_ENV === 'test';
    if (!isTest) {
      const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
      this.redisConnection = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        retryStrategy: (times: number) => {
          // Exponential backoff up to 2 seconds with randomized jitter to prevent reconnect storms
          const delay = Math.min(times * 100, 2000) + Math.floor(Math.random() * 200);
          logger.warn({ attempt: times, delayMs: delay }, '[QueueService] Redis connection lost, retrying...');
          return delay;
        },
      } as any); // Type coercion for ioredis in workspace typescript
      this.redisConnection.on('error', (err) => {
        logger.error({ err }, '[QueueService] Redis connection error');
      });
      this.startBackpressureMonitor();
    }
  }

  private startBackpressureMonitor() {
    this.backpressureTimer = setInterval(() => {
      try {
        const avgDbLatency = dbQueryDurations.length > 0 
          ? dbQueryDurations.reduce((a: number, b: number) => a + b, 0) / dbQueryDurations.length 
          : 0;
        const avgLag = eventLoopLagMonitor.getLagMs();

        this.adjustConcurrency(avgDbLatency, avgLag);
      } catch (err) {
        logger.error({ err }, '[QueueService] Error running backpressure monitor tick');
      }
    }, 10000);
  }

  public adjustConcurrency(dbLatencyMs: number, eventLoopLagMs: number) {
    for (const [name, worker] of this.workers.entries()) {
      let targetConcurrency = 5;
      if (dbLatencyMs > 500 || eventLoopLagMs > 100) {
        targetConcurrency = 1;
        logger.warn(
          { queueName: name, dbLatencyMs, eventLoopLagMs },
          '[QueueService] CRITICAL resource pressure detected. Concurrency scaled down to 1.'
        );
      } else if (dbLatencyMs > 250 || eventLoopLagMs > 50) {
        targetConcurrency = 2;
        logger.warn(
          { queueName: name, dbLatencyMs, eventLoopLagMs },
          '[QueueService] WARNING resource pressure detected. Concurrency scaled down to 2.'
        );
      }
      
      if (worker.concurrency !== targetConcurrency) {
        worker.concurrency = targetConcurrency;
        logger.info({ queueName: name, concurrency: targetConcurrency }, '[QueueService] Adjusted worker concurrency');
      }
    }
  }

  public static getInstance(): QueueService {
    if (!QueueService._instance) {
      QueueService._instance = new QueueService();
    }
    return QueueService._instance;
  }

  public getQueue(queueName: string): Queue | null {
    if (process.env.NODE_ENV === 'test') {
      return null;
    }
    if (!this.queues.has(queueName) && this.redisConnection) {
      const queue = new Queue(queueName, {
        connection: this.redisConnection as any,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });
      this.queues.set(queueName, queue);
    }
    return this.queues.get(queueName) || null;
  }

  public async enqueue(queueName: string, jobName: string, data: any, jobId?: string): Promise<void> {
    const context = traceLocalStorage.getStore();
    const payload = {
      ...data,
      _traceContext: context ? {
        traceId: context.traceId,
        userId: context.userId,
      } : undefined
    };

    if (process.env.NODE_ENV === 'test') {
      logger.debug({ queueName, jobName, data: payload }, '[QueueService] Mock enqueue in test mode');
      return;
    }
    const queue = this.getQueue(queueName);
    if (queue) {
      await queue.add(jobName, payload, { jobId });
      logger.info({ queueName, jobName, jobId }, '[QueueService] Job enqueued successfully');
    } else {
      logger.warn({ queueName, jobName }, '[QueueService] Failed to enqueue: Queue is not initialized');
    }
  }

  public registerWorker(queueName: string, processor: (job: Job) => Promise<any>): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    if (!this.redisConnection) return;

    const wrappedProcessor = async (job: Job) => {
      const waitTimeMs = Date.now() - job.timestamp;
      if (queueJobWaitTime) {
        queueJobWaitTime.observe({ queue_name: queueName }, waitTimeMs / 1000);
      }
      
      const start = Date.now();
      try {
        const result = await processor(job);
        const durationMs = Date.now() - start;
        if (queueJobDuration) {
          queueJobDuration.observe({ queue_name: queueName, status: 'success' }, durationMs / 1000);
        }
        return result;
      } catch (err) {
        const durationMs = Date.now() - start;
        if (queueJobDuration) {
          queueJobDuration.observe({ queue_name: queueName, status: 'failed' }, durationMs / 1000);
        }
        throw err;
      }
    };

    const worker = new Worker(queueName, wrappedProcessor, {
      connection: this.redisConnection as any,
      concurrency: 5,
      stalledInterval: 15000, // Detect stalled jobs within 15 seconds
      maxStalledCount: 3,     // Fail job if it stalls more than 3 times
    });

    worker.on('completed', (job) => {
      logger.info({ queueName, jobId: job.id }, '[QueueService] Job completed');
    });

    worker.on('failed', (job, err) => {
      logger.error({ queueName, jobId: job?.id, err }, '[QueueService] Job failed');
    });

    this.workers.set(queueName, worker);
  }

  public async replayFailedJobs(queueName: string): Promise<number> {
    const queue = this.getQueue(queueName);
    if (!queue) return 0;
    const failed = await queue.getFailed();
    for (const job of failed) {
      await job.retry();
    }
    return failed.length;
  }

  public setWorkerConcurrency(queueName: string, concurrency: number): number | null {
    const worker = this.workers.get(queueName);
    if (!worker) {
      return null;
    }

    worker.concurrency = concurrency;
    logger.warn({ queueName, concurrency }, '[QueueService] Worker concurrency updated manually');
    return worker.concurrency;
  }

  public async getQueueStatus(queueName: string): Promise<QueueRuntimeStatus> {
    const queue = this.getQueue(queueName);
    const worker = this.workers.get(queueName);
    const status: QueueRuntimeStatus = {
      queueName,
      redisStatus: process.env.NODE_ENV === 'test' ? 'test' : (this.redisConnection?.status || 'unavailable'),
      queueAvailable: Boolean(queue),
      worker: {
        registered: Boolean(worker),
        concurrency: worker?.concurrency ?? null,
      },
      counts: null,
    };

    if (!queue) {
      status.degradedReason = 'Queue is not initialized.';
      return status;
    }

    try {
      status.counts = await queue.getJobCounts();
    } catch (err: unknown) {
      status.degradedReason = errorMessage(err);
      logger.error({ err, queueName }, '[QueueService] Failed to read queue status');
    }

    return status;
  }

  public async getAllQueueStatuses(): Promise<QueueRuntimeStatus[]> {
    return Promise.all(Object.values(QUEUES).map((queueName) => this.getQueueStatus(queueName)));
  }

  public async pauseWorker(queueName: string): Promise<void> {
    const worker = this.workers.get(queueName);
    if (worker) {
      await worker.pause();
      logger.warn({ queueName }, '[QueueService] Worker paused (emergency control)');
    }
  }

  public async resumeWorker(queueName: string): Promise<void> {
    const worker = this.workers.get(queueName);
    if (worker) {
      await worker.resume();
      logger.info({ queueName }, '[QueueService] Worker resumed');
    }
  }

  public async closeAll(): Promise<void> {
    logger.info('[QueueService] Closing all workers and queues...');

    if (this.backpressureTimer) {
      clearInterval(this.backpressureTimer);
      this.backpressureTimer = null;
      logger.info('[QueueService] Stopped backpressure monitor timer');
    }

    // 1. Close (drain) all workers concurrently to avoid sequential wait overhead
    const workerPromises = Array.from(this.workers.entries()).map(async ([name, worker]) => {
      try {
        await worker.pause(true); // pause fetching new jobs first
        logger.info({ queueName: name }, '[QueueService] Paused worker for shutdown');
        await worker.close();
        logger.info({ queueName: name }, '[QueueService] Worker closed and drained successfully');
      } catch (err) {
        logger.error({ queueName: name, err }, '[QueueService] Error closing worker');
      }
    });
    await Promise.all(workerPromises);

    // 2. Close all queues
    const queuePromises = Array.from(this.queues.entries()).map(async ([name, queue]) => {
      try {
        await queue.close();
        logger.info({ queueName: name }, '[QueueService] Queue closed');
      } catch (err) {
        logger.error({ queueName: name, err }, '[QueueService] Error closing queue');
      }
    });
    await Promise.all(queuePromises);

    // 3. Quit Redis connection
    if (this.redisConnection) {
      try {
        await this.redisConnection.quit();
        logger.info('[QueueService] Redis connection quit successfully');
      } catch (err) {
        logger.error({ err }, '[QueueService] Error quitting Redis connection');
      }
    }
    logger.info('[QueueService] Closed all connections');
  }

  public isHealthy(): boolean {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    return this.redisConnection !== null && this.redisConnection.status === 'ready';
  }
}
