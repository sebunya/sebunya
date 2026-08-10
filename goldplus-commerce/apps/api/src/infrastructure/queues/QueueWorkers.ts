import { Job } from 'bullmq';
import { QueueService, QUEUES } from './QueueService';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import { eq } from 'drizzle-orm';
import { telemetryDispatcher } from '../telemetry/TelemetryDispatchService';
import { logger } from '../logging/logger';
import { RecordPaymentWebhookUseCase } from '../../application/use-cases/payments/RecordPaymentWebhookUseCase';
import { Registry } from '../Registry';
import { traceLocalStorage } from '../observability/TraceContext';
import crypto from 'crypto';

export function registerAllWorkers(): void {
  const queueService = QueueService.getInstance();

  if (process.env.NODE_ENV === 'test') {
    return;
  }

  // Helper to extract trace context from job payload or create a new one
  const getContext = (job: Job) => {
    const traceContext = (job.data as any)?._traceContext;
    return {
      traceId: traceContext?.traceId || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15)),
      userId: traceContext?.userId,
      jobId: job.id,
    };
  };

  // 1. Telemetry Dispatch Worker
  queueService.registerWorker(QUEUES.TELEMETRY_DISPATCH, async (job: Job) => {
    const ctx = getContext(job);
    return traceLocalStorage.run(ctx, async () => {
      const { outboxId } = job.data as { outboxId: string };
      logger.info({ outboxId }, '[QueueWorker] Telemetry dispatch job started');

      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, outboxId))
        .limit(1)
        .for('update', { skipLocked: true });

      const eventRecord = rows[0];
      if (!eventRecord) {
        logger.info({ outboxId }, '[QueueWorker] Event locked, skipped, or not found');
        return;
      }

      if (eventRecord.isProcessed) {
        logger.info({ outboxId }, '[QueueWorker] Event already processed');
        return;
      }

      try {
        await (telemetryDispatcher as any).dispatch(eventRecord.payload);
        
        await db
          .update(outboxEvents)
          .set({ isProcessed: true, processedAt: new Date(), status: 'sent' })
          .where(eq(outboxEvents.id, outboxId));

        logger.info({ outboxId }, '[QueueWorker] Telemetry event dispatched successfully');
      } catch (err: any) {
        const errMsg = err.message || String(err);
        logger.error({ outboxId, err }, '[QueueWorker] Telemetry dispatch failed');

        await db
          .update(outboxEvents)
          .set({
            attemptCount: eventRecord.attemptCount + 1,
            lastError: errMsg,
            status: 'retrying',
          })
          .where(eq(outboxEvents.id, outboxId));

        throw err;
      }
    });
  });

  // 2. Webhook Retries Worker
  queueService.registerWorker(QUEUES.WEBHOOK_RETRIES, async (job: Job) => {
    const ctx = getContext(job);
    return traceLocalStorage.run(ctx, async () => {
      const payload = job.data as {
        provider: string;
        orderId: string;
        providerReference: string | null;
        amount: number;
        outcome: 'SUCCESS' | 'FAILED';
        idempotencyKey: string | null;
        signatureVerified: boolean;
      };

      logger.info({ orderId: payload.orderId }, '[QueueWorker] Processing payment webhook retry');

      const useCase = new RecordPaymentWebhookUseCase(Registry.getInstance().paymentRepo);
      const result = await useCase.execute(payload);

      if (!result.ok) {
        logger.error({ orderId: payload.orderId, code: result.code }, '[QueueWorker] Webhook retry failed');
        throw new Error(`Webhook processing failed: ${result.message}`);
      }

      logger.info({ orderId: payload.orderId }, '[QueueWorker] Webhook retry processed successfully');
    });
  });

  // 3. Email/SMS Jobs Worker
  queueService.registerWorker(QUEUES.EMAIL_JOBS, async (job: Job) => {
    const ctx = getContext(job);
    return traceLocalStorage.run(ctx, async () => {
      const { outboxId } = job.data as { outboxId: string };
      logger.info({ outboxId }, '[QueueWorker] Notification dispatch job started');

      const registry = Registry.getInstance();
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, outboxId))
        .limit(1);

      const notificationRecord = rows[0];
      if (!notificationRecord || notificationRecord.isProcessed) {
        return;
      }

      try {
        const result = await registry.processOutboxBatchUseCase.execute();
        logger.info({ outboxId, result }, '[QueueWorker] Notification batch processed');
      } catch (err) {
        logger.error({ outboxId, err }, '[QueueWorker] Notification processing failed');
        throw err;
      }
    });
  });

  // 4. Recommendation Processing Worker
  queueService.registerWorker(QUEUES.RECOMMENDATION_PROCESSING, async (job: Job) => {
    const ctx = getContext(job);
    return traceLocalStorage.run(ctx, async () => {
      const { eventData } = job.data as { eventData: any };
      logger.info('[QueueWorker] Async recommendation event processing started');

      try {
        const registry = Registry.getInstance();
        const event = (registry.trackRecommendationEventUseCase as any).events;
        const RecommendationEvent = (await import('../../domain/recommendations/RecommendationEvent')).RecommendationEvent;
        const createdEvent = RecommendationEvent.create(eventData);
        await event.save(createdEvent);
        logger.info({ eventId: createdEvent.id }, '[QueueWorker] Recommendation event persisted successfully');
      } catch (err) {
        logger.error({ err }, '[QueueWorker] Recommendation event persistence failed');
        throw err;
      }
    });
  });

  // 5. Analytics Fanout & Synthetic Monitor Worker
  queueService.registerWorker(QUEUES.ANALYTICS_FANOUT, async (job: Job) => {
    const ctx = getContext(job);
    return traceLocalStorage.run(ctx, async () => {
      const registry = Registry.getInstance();
      if (job.name === 'recommendation-materialize-cron') {
        logger.info('[QueueWorker] Recommendation materialization task started');
        const result = await registry.recommendationMaterializer.execute();
        if (!result.success) {
          throw new Error('Recommendation materialization failed');
        }
      } else if (job.name === 'seo-crawl') {
        // Organic Growth OS: first-party technical crawl. The use case enforces
        // the SSRF host allowlist, page/depth/time limits and cancellation
        // (run status flips to CANCELLED between pages).
        const { runId, maxPages, startUrl } = job.data as { runId: string; maxPages?: number; startUrl?: string };
        const { CrawlSiteUseCase } = await import('../../application/use-cases/seo-growth/CrawlSiteUseCase');
        const { FetchSeoPageFetcher } = await import('../seo/FetchSeoPageFetcher');
        const uc = new CrawlSiteUseCase(registry.seoGrowthRepo, new FetchSeoPageFetcher());
        const outcome = await uc.execute(runId, { maxPages, startUrl });
        logger.info({ runId, ...outcome }, '[QueueWorker] SEO crawl finished');
      } else if (job.name === 'seo-gsc-sync') {
        // Organic Growth OS: incremental GSC search-analytics sync. When
        // credentials are absent the use case is an honest no-op
        // (READY_FOR_CREDENTIALS) — nothing fake is written.
        const { SyncGscPerformanceUseCase } = await import('../../application/use-cases/seo-growth/SyncGscPerformanceUseCase');
        // 0118: credentials resolve vault-first (integration control plane),
        // env-second (bootstrap/emergency).
        const { resolveGscClientVaultFirst } = await import('../seo/SeoIntegrationSyncRunner');
        const uc = new SyncGscPerformanceUseCase({
          client: await resolveGscClientVaultFirst(),
          store: registry.seoGrowthRepo,
        });
        const outcome = await uc.execute();
        logger.info({ ...outcome }, '[QueueWorker] GSC sync finished');
        if (outcome.status === 'FAILED') throw new Error(outcome.error);
      } else if (job.name === 'seo-integration-sync') {
        // 0118 Integrations Control Plane: per-connection sync jobs, isolated
        // per connection; failures land on the job row, never in commerce paths.
        const { runSeoIntegrationSyncJob } = await import('../seo/SeoIntegrationSyncRunner');
        await runSeoIntegrationSyncJob(job.data as { jobId: string; connectionId: string; providerId: string });
      } else if (job.name === 'abandonment-scan-cron') {
        // Wave 2E-1: the hourly evaluator is the ONLY writer of abandonment
        // classifications; each new one is announced on ABANDONED_CART_EVENTS.
        const result = await registry.abandonmentUseCase.scan();
        logger.info({ ...result }, '[QueueWorker] Abandonment scan completed');
      } else {
        logger.info('[QueueWorker] Analytics fanout / Synthetic monitor task started');
        const result = await registry.syntheticMonitor.execute();
        if (!result.success) {
          throw new Error('Synthetic commerce check failed');
        }
      }
    });
  });

  // 6. Abandoned-cart events (Wave 2E-1). This queue existed with neither producer
  // nor worker; it now carries each NEW abandonment classification. The v1 consumer
  // acknowledges and logs — campaign eligibility (consent/suppression/frequency
  // gated) attaches here in the campaign wave without touching the producer.
  queueService.registerWorker(QUEUES.ABANDONED_CART_EVENTS, async (job: Job) => {
    const ctx = getContext(job);
    return traceLocalStorage.run(ctx, async () => {
      const { recordId, cartId, itemCount, subtotalUgx } = job.data ?? {};
      logger.info(
        { recordId, cartId, itemCount, subtotalUgx },
        '[QueueWorker] Abandonment classification received',
      );
    });
  });

  // Schedule cron jobs
  const syntheticQueue = queueService.getQueue(QUEUES.ANALYTICS_FANOUT);
  if (syntheticQueue) {
    // 5-minute synthetic commerce check
    syntheticQueue.add(
      'synthetic-cron',
      {},
      {
        repeat: {
          pattern: '*/5 * * * *',
        },
        jobId: 'synthetic-cron-job',
      }
    ).catch(err => logger.error({ err }, '[QueueWorkers] Failed to schedule synthetic cron job'));

    // Hourly abandonment scan (Wave 2E-1)
    syntheticQueue.add(
      'abandonment-scan-cron',
      {},
      {
        repeat: {
          pattern: '30 * * * *',
        },
        jobId: 'abandonment-scan-job',
      }
    ).catch(err => logger.error({ err }, '[QueueWorkers] Failed to schedule abandonment scan cron'));

    // Hourly recommendation materialization
    syntheticQueue.add(
      'recommendation-materialize-cron',
      {},
      {
        repeat: {
          pattern: '0 * * * *',
        },
        jobId: 'recommendation-materialize-job',
      }
    ).catch(err => logger.error({ err }, '[QueueWorkers] Failed to schedule recommendation materialization cron job'));
  }

  logger.info('[QueueWorker] All BullMQ worker consumers registered successfully with Trace propagation');
}
