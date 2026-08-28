import { Hono } from 'hono';
import { QueueService, QUEUES } from '../../../../infrastructure/queues/QueueService';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { logger } from '../../../../infrastructure/logging/logger';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';

// Replaying failed jobs and changing worker concurrency are mutating
// operations. They used to carry an exemption note that was not true:
// QueueService wrote nothing, so afterwards nobody could say who did it.
const routes = new Hono();

// Enforce auth globally for all queue admin actions
routes.use('*', authMiddleware);

// Helper to validate queue names
const validQueues: Set<string> = new Set(Object.values(QUEUES));

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * GET /admin/queues/status
 * Inspect queue counts and active worker settings.
 */
routes.get('/status', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const queueName = c.req.query('queueName');

  if (queueName && !validQueues.has(queueName)) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_QUEUE', message: `Queue "${queueName}" is not valid.` },
    };
    return c.json(res, 400);
  }

  try {
    const queueService = QueueService.getInstance();
    const queues = queueName
      ? [await queueService.getQueueStatus(queueName)]
      : await queueService.getAllQueueStatuses();

    const res: ApiResponse<{ queues: Awaited<ReturnType<typeof queueService.getAllQueueStatuses>> }> = {
      success: true,
      data: { queues },
    };
    return c.json(res, 200);
  } catch (err: unknown) {
    logger.error({ err, queueName }, '[AdminQueueRoute] Failed to read queue status');
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'QUEUE_STATUS_FAILED', message: errorMessage(err) || 'Internal error' },
    };
    return c.json(res, 500);
  }
});

/**
 * POST /admin/queues/replay
 * Replay failed jobs on a specified queue
 */
routes.post('/replay', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const queueName = body?.queueName;

  if (!queueName || !validQueues.has(queueName)) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_QUEUE', message: `Queue "${queueName}" is not valid.` },
    };
    return c.json(res, 400);
  }

  try {
    const queueService = QueueService.getInstance();
    const replayedCount = await queueService.replayFailedJobs(queueName);
    await Registry.getInstance().createAuditLogUseCase.execute({
      actorId: (c.get('user') as { id?: string } | undefined)?.id ?? 'unknown',
      action: 'QUEUE_FAILED_JOBS_REPLAYED',
      entity: 'queue',
      entityId: queueName,
      newState: { replayed: replayedCount },
    }).catch((err: unknown) => logger.error({ err, queueName }, '[AdminQueueRoute] audit write failed'));
    
    const res: ApiResponse<{ replayed: number }> = {
      success: true,
      data: { replayed: replayedCount },
    };
    return c.json(res, 200);
  } catch (err: unknown) {
    logger.error({ err, queueName }, '[AdminQueueRoute] Failed to replay failed jobs');
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'REPLAY_FAILED', message: errorMessage(err) || 'Internal error' },
    };
    return c.json(res, 500);
  }
});

/**
 * POST /admin/queues/concurrency
 * Dynamically adjust worker concurrency for a queue
 */
routes.post('/concurrency', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const queueName = body?.queueName;
  const concurrency = Number(body?.concurrency);

  if (!queueName || !validQueues.has(queueName)) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_QUEUE', message: `Queue "${queueName}" is not valid.` },
    };
    return c.json(res, 400);
  }

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_CONCURRENCY', message: 'Concurrency must be an integer between 1 and 100.' },
    };
    return c.json(res, 400);
  }

  try {
    const queueService = QueueService.getInstance();
    const updatedConcurrency = queueService.setWorkerConcurrency(queueName, concurrency);
    if (updatedConcurrency === null) {
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'WORKER_NOT_FOUND', message: `Active worker for queue "${queueName}" not found.` },
      };
      return c.json(res, 404);
    }

    await Registry.getInstance().createAuditLogUseCase.execute({
      actorId: (c.get('user') as { id?: string } | undefined)?.id ?? 'unknown',
      action: 'QUEUE_CONCURRENCY_CHANGED',
      entity: 'queue',
      entityId: queueName,
      newState: { concurrency: updatedConcurrency },
    }).catch((err: unknown) => logger.error({ err, queueName }, '[AdminQueueRoute] audit write failed'));
    const res: ApiResponse<{ queueName: string; concurrency: number }> = {
      success: true,
      data: { queueName, concurrency: updatedConcurrency },
    };
    return c.json(res, 200);
  } catch (err: unknown) {
    logger.error({ err, queueName }, '[AdminQueueRoute] Failed to update concurrency');
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'CONCURRENCY_UPDATE_FAILED', message: errorMessage(err) || 'Internal error' },
    };
    return c.json(res, 500);
  }
});

export default routes;
