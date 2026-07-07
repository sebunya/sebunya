import { afterEach, describe, expect, test, vi } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { QUEUES, QueueService } from '../../apps/api/src/infrastructure/queues/QueueService';

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } }, 401);
    }

    c.set('user', {
      id: 'queue-admin',
      email: 'admin@goldplus.com',
      permissions: auth === 'Bearer forbidden' ? [] : ['settings.manage'],
    });
    await next();
  },
}));

const adminHeaders = { Authorization: 'Bearer admin' };
const jsonAdminHeaders = { ...adminHeaders, 'Content-Type': 'application/json' };

describe('Admin queue operations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rejects unauthenticated and unauthorized queue admin requests', async () => {
    const unauthenticated = await app.request('/admin/queues/status');
    expect(unauthenticated.status).toBe(401);

    const forbidden = await app.request('/admin/queues/status', {
      headers: { Authorization: 'Bearer forbidden' },
    });
    expect(forbidden.status).toBe(403);
  });

  test('GET /admin/queues/status returns queue runtime status', async () => {
    const queueService = QueueService.getInstance();
    vi.spyOn(queueService, 'getAllQueueStatuses').mockResolvedValue([
      {
        queueName: QUEUES.TELEMETRY_DISPATCH,
        redisStatus: 'ready',
        queueAvailable: true,
        worker: { registered: true, concurrency: 5 },
        counts: { waiting: 1, active: 0, failed: 0 },
      },
    ]);

    const res = await app.request('/admin/queues/status', { headers: adminHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.queues).toHaveLength(1);
    expect(body.data.queues[0].queueName).toBe(QUEUES.TELEMETRY_DISPATCH);
  });

  test('POST /admin/queues/concurrency validates integer concurrency', async () => {
    const res = await app.request('/admin/queues/concurrency', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ queueName: QUEUES.TELEMETRY_DISPATCH, concurrency: 1.5 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.code).toBe('INVALID_CONCURRENCY');
  });

  test('POST /admin/queues/concurrency updates worker concurrency through QueueService', async () => {
    const queueService = QueueService.getInstance();
    const update = vi.spyOn(queueService, 'setWorkerConcurrency').mockReturnValue(7);

    const res = await app.request('/admin/queues/concurrency', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ queueName: QUEUES.TELEMETRY_DISPATCH, concurrency: 7 }),
    });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(QUEUES.TELEMETRY_DISPATCH, 7);
    const body = await res.json() as any;
    expect(body.data).toEqual({ queueName: QUEUES.TELEMETRY_DISPATCH, concurrency: 7 });
  });

  test('POST /admin/queues/concurrency returns 404 when no worker is registered', async () => {
    const res = await app.request('/admin/queues/concurrency', {
      method: 'POST',
      headers: jsonAdminHeaders,
      body: JSON.stringify({ queueName: QUEUES.TELEMETRY_DISPATCH, concurrency: 7 }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error.code).toBe('WORKER_NOT_FOUND');
  });
});
